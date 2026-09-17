import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { exportFormPdf } from "../../api/formHooks";
import type { Ncr, Capa, Rma, WorkOrder, ErpPurchaseRequisition } from "../../api/types";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { TextAreaField } from "../../components/forms/Field";
import { useWorkflowAction, extractErrorMessage } from "../../hooks/useWorkflowAction";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { Modal } from "../../components/modals/Modal";
import { useSetAssistantContext } from "../../hooks/useAssistantContext";
import { AiFieldAssistant } from "../../components/shared/AiFieldAssistant";
import { AiStructuredSuggestion } from "../../components/shared/AiStructuredSuggestion";
import { useToast } from "../../components/shared/ToastProvider";
import { getFormLayout } from "../../components/forms/layouts";
import { GenericFormRenderer } from "../../components/forms/GenericFormRenderer";
import { useFormEditorState } from "../../components/forms/useFormEditorState";
import { CreateRiskButton } from "../../components/shared/CreateRiskButton";
import { LinkSalesAccountButton } from "../../components/shared/LinkSalesAccountButton";
import { CreateCustomerButton } from "../../components/shared/CreateCustomerButton";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";

const FORM_TYPE = "ncr";

const ncrHooks = createResourceHooks<Ncr>("ncr");
const capaHooks = createResourceHooks<Capa>("capa");
const rmaHooks = createResourceHooks<Rma>("rma");
const workOrderHooks = createResourceHooks<WorkOrder>("work-orders");
const requisitionHooks = createResourceHooks<ErpPurchaseRequisition>("erp/requisitions");

interface EightDReport {
  id: number;
  ncrId: number | null;
  currentStep: number;
}
const eightDHooks = createResourceHooks<EightDReport>("8d");

/**
 * Replaces NcrDetailPage.tsx's tab strip: one split-screen workspace — the
 * real fill-in form (left, editable) beside a live read-only recreation
 * (right) that updates on every keystroke, with status/linking controls
 * consolidated onto the same screen instead of spread across tabs and a
 * separate floating "Open Form" window. Every endpoint this page calls
 * (workflow actions, /forms/ncr/:id/*, /capa, /8d, /rma, /work-orders,
 * /erp/requisitions) is unchanged from NcrDetailPage.tsx/CapaTab — only the
 * layout moved. See the plan (deep-inventing-nova) for the full rationale.
 */
export function NcrWorkspacePage() {
  const { id } = useParams();
  const ncrId = Number(id);
  const toast = useToast();
  const [showHistory, setShowHistory] = useState(false);

  const { data: ncr, isLoading } = ncrHooks.useOne(ncrId);
  useSetAssistantContext("ncr", ncrId, ncr ? `NCR #${ncr.id}` : `NCR #${ncrId}`);

  const historyKey: unknown[][] = [["workflow-history", "ncr", ncrId]];
  // Each workflow action also syncs a field onto the official document
  // server-side (see ncr.formSync.ts) — invalidate its query too, or the
  // right-pane preview keeps showing stale (blank) data until a reload.
  const formDataKey: unknown[][] = [["form-data", FORM_TYPE, ncrId]];
  const workflowInvalidateKeys = [...historyKey, ...formDataKey];
  const containmentAction = useWorkflowAction("ncr", "containment", { successMessage: "Containment recorded.", invalidateKeys: workflowInvalidateKeys });
  const rootCauseAction = useWorkflowAction("ncr", "root-cause", { successMessage: "Root cause recorded.", invalidateKeys: workflowInvalidateKeys });
  const correctiveActionAction = useWorkflowAction("ncr", "corrective-action", { successMessage: "Corrective action recorded.", invalidateKeys: workflowInvalidateKeys });
  const closeAction = useWorkflowAction("ncr", "close", { successMessage: "NCR closed.", invalidateKeys: workflowInvalidateKeys });

  const layout = getFormLayout(FORM_TYPE);
  const { isLoading: formLoading, values, updateField, isSaving } = useFormEditorState(FORM_TYPE, ncrId);

  async function handleDownload() {
    try {
      const bytes = await exportFormPdf(FORM_TYPE, ncrId);
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ncr-${ncrId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't export this form — save it at least once first."));
    }
  }

  if (isLoading || !ncr) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">
            NCR #{ncr.id} — {ncr.title}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge value={ncr.severity} />
            <StatusBadge value={ncr.status} />
            <span className="text-xs text-muted-foreground">{formLoading ? "Loading form…" : isSaving ? "Saving…" : "Saved"}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowHistory(true)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            History
          </button>
          <button onClick={handleDownload} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Download PDF
          </button>
          <WorkflowActionButton
            label="Close NCR"
            navKey="ncr"
            action={closeAction}
            onClick={() => closeAction.mutate({ id: ncrId })}
            visible={ncr.status === "corrective_action"}
            variant="primary"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Left pane — status/linking controls + the real editable form. */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
            <p className="text-sm">{ncr.description || "No description provided."}</p>
            <ActionForm
              label="Containment"
              value={ncr.containment}
              onSubmit={(value) => containmentAction.mutate({ id: ncrId, containment: value })}
              assistant={{
                module: "ncr",
                recordId: ncrId,
                buildPrompt: () =>
                  `Recommend a containment action for NCR #${ncr.id} ("${ncr.title}"). Problem: ${ncr.description || "not described"}.` +
                  " Keep it specific and actionable — this is a draft for a quality engineer to review and edit, not a final record.",
              }}
            />
            {ncr.status === "open" ? (
              <p className="text-sm text-muted-foreground">Record containment above first — root cause can't be recorded before that.</p>
            ) : (
              <div className="border-t border-border pt-4">
                <ActionForm
                  label="Root cause"
                  value={ncr.rootCause}
                  onSubmit={(value) => rootCauseAction.mutate({ id: ncrId, rootCause: value })}
                  structuredRootCause={{ ncrId: ncr.id, title: ncr.title, description: ncr.description, containment: ncr.containment }}
                />
              </div>
            )}
            {ncr.status !== "open" && ncr.status !== "contained" && (
              <div className="border-t border-border pt-4">
                <ActionForm
                  label="Corrective action"
                  value={ncr.correctiveAction}
                  onSubmit={(value) => correctiveActionAction.mutate({ id: ncrId, correctiveAction: value })}
                />
              </div>
            )}
          </div>

          <LinkedRecordsPanel ncrId={ncrId} ncrTitle={ncr.title} />

          <AttachmentsPanel entityType="ncr" entityId={ncrId} />

          <div className="rounded-lg border border-border bg-card p-4">
            {formLoading || !layout ? (
              <p className="text-sm text-muted-foreground">Loading form…</p>
            ) : (
              <GenericFormRenderer layout={layout} data={values} onChange={updateField} />
            )}
          </div>
        </div>

        {/* Right pane — live read-only recreation, fed the same in-memory state as the left pane's form (no network round trip, no debounce). */}
        <div className="rounded-lg border border-border bg-card p-4 xl:sticky xl:top-4 xl:h-fit">
          {formLoading || !layout ? (
            <p className="text-sm text-muted-foreground">Preview will appear once the form loads.</p>
          ) : (
            <GenericFormRenderer layout={layout} data={values} onChange={() => {}} readOnly />
          )}
        </div>
      </div>

      <Modal title="History" isOpen={showHistory} onClose={() => setShowHistory(false)}>
        <WorkflowHistoryPanel moduleName="ncr" recordId={ncrId} bare />
      </Modal>
    </div>
  );
}

interface NcrRootCauseSuggestion {
  rootCause: string;
  confidence: number;
  reasoning: string;
  suggestedCorrectiveActions: string[];
}

function ActionForm({
  label,
  value,
  onSubmit,
  assistant,
  structuredRootCause,
}: {
  label: string;
  value: string | null;
  onSubmit: (value: string) => void;
  assistant?: { module: string; recordId: number; buildPrompt: () => string };
  /** Root-cause specific — wires the real, schema-validated /ai/root-cause pipeline (Phase 4 built it, Phase 5 gives it its first real UI) via the standardized accept/reject panel, instead of the free-text assistant every other ActionForm uses. */
  structuredRootCause?: { ncrId: number; title: string; description: string | null; containment: string | null };
}) {
  const [draft, setDraft] = useState(value ?? "");
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft);
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        {assistant && (
          <AiFieldAssistant module={assistant.module} recordId={assistant.recordId} buildInitialPrompt={assistant.buildPrompt} onInsert={setDraft} />
        )}
        {structuredRootCause && (
          <AiStructuredSuggestion<NcrRootCauseSuggestion>
            endpoint="/ai/root-cause"
            title="AI Root Cause Suggestion"
            triggerLabel="Suggest Root Cause"
            acceptLabel="Use This Root Cause"
            buildPayload={() => ({
              ncrId: structuredRootCause.ncrId,
              ncrData: { title: structuredRootCause.title, description: structuredRootCause.description, containment: structuredRootCause.containment },
            })}
            onAccept={(output) => setDraft(output.rootCause)}
            renderPreview={(output) => (
              <div className="flex flex-col gap-3 text-sm">
                <p>{output.rootCause}</p>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Reasoning</p>
                  <p className="text-muted-foreground">{output.reasoning}</p>
                </div>
                {output.suggestedCorrectiveActions.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Suggested Corrective Actions</p>
                    <ul className="list-inside list-disc text-muted-foreground">
                      {output.suggestedCorrectiveActions.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          />
        )}
      </div>
      <TextAreaField label="" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button type="submit" className="w-fit rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
        Save
      </button>
    </form>
  );
}

/**
 * Every record type that can link to an NCR, consolidated onto this one
 * screen: CAPA keeps its existing create-linked behavior (ported byte-for-
 * byte from NcrDetailPage.tsx's old CapaTab) and gains "attach existing"
 * (PATCH /capa/:id with {ncrId} — already accepted by updateCapaSchema,
 * just never exposed in the UI before). 8D/RMA/Work Order/Purchase
 * Requisition have real ncrId/linkedNcrId FK columns but never had ANY UI
 * surfacing them from the NCR side — listed here read-only, closing that
 * gap, without inventing new create-from-NCR flows for them (out of scope;
 * each already has its own real creation flow in its own module).
 */
function LinkedRecordsPanel({ ncrId, ncrTitle }: { ncrId: number; ncrTitle: string }) {
  const navigate = useNavigate();
  const { data: capas = [] } = capaHooks.useList();
  const createCapa = capaHooks.useCreate();
  const attachCapa = capaHooks.useUpdate();
  const { data: eightDs = [] } = eightDHooks.useList();
  const { data: rmas = [] } = rmaHooks.useList();
  const { data: workOrders = [] } = workOrderHooks.useList();
  const { data: requisitions = [] } = requisitionHooks.useList();
  const [attachId, setAttachId] = useState("");

  const linkedCapas = capas.filter((c) => c.ncrId === ncrId);
  const linkedEightDs = eightDs.filter((r) => r.ncrId === ncrId);
  const linkedRmas = rmas.filter((r) => r.linkedNcrId === ncrId);
  const linkedWorkOrders = workOrders.filter((w) => w.linkedNcrId === ncrId);
  const linkedRequisitions = requisitions.filter((r) => r.linkedNcrId === ncrId);
  const totalLinked = linkedCapas.length + linkedEightDs.length + linkedRmas.length + linkedWorkOrders.length + linkedRequisitions.length;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Linked Records</h3>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => createCapa.mutate({ ncrId }, { onSuccess: (created) => navigate(`/capa/${created.id}`) })}
            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
          >
            + Create linked CAPA
          </button>
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const capaId = Number(attachId);
              if (!capaId) return;
              attachCapa.mutate({ id: capaId, ncrId }, { onSuccess: () => setAttachId("") });
            }}
          >
            <input
              value={attachId}
              onChange={(e) => setAttachId(e.target.value)}
              placeholder="CAPA #"
              className="w-16 rounded-md border border-border bg-transparent px-2 py-1 text-xs"
            />
            <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
              Attach existing CAPA
            </button>
          </form>
          <CreateRiskButton sourceType="NCR" sourceId={ncrId} defaultTitle={`Risk from ${ncrTitle}`} defaultDepartment="quality" defaultCategory="process" />
          <LinkSalesAccountButton sourceType="NCR" sourceId={ncrId} defaultAccountName={ncrTitle} />
          <CreateCustomerButton sourceType="NCR" sourceId={ncrId} defaultLegalName={ncrTitle} />
        </div>
      </div>

      {totalLinked === 0 && <p className="text-sm text-muted-foreground">No linked records yet.</p>}

      <ul className="flex flex-col gap-2 text-sm">
        {linkedCapas.map((c) => (
          <li key={`capa-${c.id}`} className="border-b border-border pb-1">
            <button onClick={() => navigate(`/capa/${c.id}`)} className="flex w-full items-center justify-between text-left hover:text-primary">
              <span>CAPA #{c.id}</span>
              <StatusBadge value={c.status} />
            </button>
          </li>
        ))}
        {linkedEightDs.map((r) => (
          <li key={`8d-${r.id}`} className="border-b border-border pb-1">
            <button onClick={() => navigate(`/8d/${r.id}`)} className="flex w-full items-center justify-between text-left hover:text-primary">
              <span>8D #{r.id}</span>
              <span className="text-xs text-muted-foreground">D{r.currentStep}</span>
            </button>
          </li>
        ))}
        {linkedRmas.map((r) => (
          <li key={`rma-${r.id}`} className="border-b border-border pb-1">
            <button onClick={() => navigate(`/rma/${r.id}`)} className="flex w-full items-center justify-between text-left hover:text-primary">
              <span>RMA {r.rmaNumber}</span>
              <StatusBadge value={r.status} />
            </button>
          </li>
        ))}
        {linkedWorkOrders.map((w) => (
          <li key={`wo-${w.id}`} className="border-b border-border pb-1">
            <button onClick={() => navigate(`/work-orders/${w.id}`)} className="flex w-full items-center justify-between text-left hover:text-primary">
              <span>Work Order #{w.id}</span>
              <StatusBadge value={w.status} />
            </button>
          </li>
        ))}
        {linkedRequisitions.map((r) => (
          <li key={`pr-${r.id}`} className="pb-1">
            <button onClick={() => navigate(`/erp/requisitions/${r.id}`)} className="flex w-full items-center justify-between text-left hover:text-primary">
              <span>Requisition #{r.id}</span>
              <StatusBadge value={r.status} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
