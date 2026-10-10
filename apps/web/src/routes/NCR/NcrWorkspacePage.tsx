import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { exportFormPdfResult } from "../../api/formHooks";
import { PdfExportActions } from "../../components/records/PdfExportActions";
import type { Ncr, Capa, Rma, WorkOrder } from "../../api/types";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { TextAreaField } from "../../components/forms/Field";
import { useWorkflowAction, extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useWorkflowHistory } from "../../hooks/useWorkflowHistory";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { DeleteRecordButton } from "../../components/shared/DeleteRecordButton";
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
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { LoopTrail, RecordGlance } from "../../components/records/RecordStatus";
import { RecordNumberEditor } from "../../components/forms/RecordNumberField";
import { RecordSiteField } from "../../components/records/RecordSiteField";
import { NumberedCreateButton } from "../../components/forms/RecordNumberField";
import { recordHeading } from "../../lib/userRecordNumber";
import { RecordFrame } from "../../components/records/RecordFrame";
import { NcrStepDocuments } from "../../components/records/NcrStepDocuments";
import { NCR_STEPS, READ_ONLY_REASON, duePhrase, formatPerson, isPastDue, ncrLoopIndex, ncrNextAction, ncrStepKey, ncrStepLabel, statusPhrase } from "../../lib/opsLanguage";
import { useCanEditWorkflow } from "../../hooks/useWorkflowAccess";
import { useModuleFormLock } from "../../hooks/useSavedFormMode";
import { ModuleFormLock } from "../../components/forms/SavedFormLockBar";
import { useCurrentUser } from "../../hooks/useAuth";
import { rememberRecord } from "../../lib/recentRecords";
import { usePersonDirectory } from "../../hooks/usePersonDirectory";
import { NcrQuarantineSection, ON_HOLD_BLOCK_MESSAGE } from "./NcrQuarantineSection";
import { RepeatNcrBanner } from "./RepeatNcrBanner";
import { PictureRecordProvider } from "../../components/forms/pictureRecord";
import { FormSignProvider } from "../../components/forms/formSign";
import { ncrRecordedSteps } from "../../lib/ncrRecord";

const FORM_TYPE = "ncr";

const ncrHooks = createResourceHooks<Ncr>("ncr");
const capaHooks = createResourceHooks<Capa>("capa");
const rmaHooks = createResourceHooks<Rma>("rma");
const workOrderHooks = createResourceHooks<WorkOrder>("work-orders");
interface EightDReport {
  id: number;
  ncrId: number | null;
  recordNumber?: string | null;
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
  const permitted = useCanEditWorkflow("ncr");
  const formLock = useModuleFormLock(ncrId, permitted, `/ncr/${ncrId}/begin-edit`);
  const canEdit = formLock.fieldsEditable;
  const { label, people } = usePersonDirectory();
  const [showHistory, setShowHistory] = useState(false);
  const [quarantineOnHold, setQuarantineOnHold] = useState(false);

  const { data: ncr, isLoading, isError } = ncrHooks.useOne(ncrId);
  const user = useCurrentUser();
  useEffect(() => {
    if (!ncr) return;
    rememberRecord({ path: `/ncr/${ncr.id}`, title: ncr.title || recordHeading("NCR", ncr.recordNumber), type: "NCR" }, user?.id);
  }, [ncr, user?.id]);
  const updateNcr = ncrHooks.useUpdate();
  useSetAssistantContext("ncr", ncrId, ncr ? recordHeading("NCR", ncr.recordNumber) : "NCR");

  const historyKey: unknown[][] = [["workflow-history", "ncr", ncrId]];
  // Each workflow action also syncs a field onto the official document
  // server-side (see ncr.formSync.ts) — invalidate its query too, or the
  // right-pane preview keeps showing stale (blank) data until a reload.
  const formDataKey: unknown[][] = [["form-data", FORM_TYPE, ncrId]];
  const workflowInvalidateKeys = [...historyKey, ...formDataKey];
  const queryClient = useQueryClient();
  const { data: history } = useWorkflowHistory("ncr", ncrId);
  function rememberStep(data: unknown) {
    if (!data || typeof data !== "object" || !("status" in data)) return;
    queryClient.setQueryData(["ncr", ncrId], data);
  }
  const stepOptions = { invalidateKeys: workflowInvalidateKeys };
  const containmentAction = useWorkflowAction<{ id: number; containment: string }>("ncr", "containment", { successMessage: "Containment recorded.", ...stepOptions });
  const rootCauseAction = useWorkflowAction<{ id: number; rootCause: string }>("ncr", "root-cause", { successMessage: "Root cause recorded.", ...stepOptions });
  const dispositionStepAction = useWorkflowAction<{ id: number; note?: string }>("ncr", "disposition-step", { successMessage: "Disposition recorded.", ...stepOptions });
  const correctiveActionAction = useWorkflowAction<{ id: number; correctiveAction: string }>("ncr", "corrective-action", { successMessage: "Fix recorded.", ...stepOptions });
  const verifyAction = useWorkflowAction<{ id: number; verification: string }>("ncr", "verify", { successMessage: "Verification recorded.", ...stepOptions });
  const closeAction = useWorkflowAction("ncr", "close", { successMessage: "NCR closed.", ...stepOptions });

  const layout = getFormLayout(FORM_TYPE);
  const { isLoading: formLoading, values, updateField, previewField, saveNow, isSaving } = useFormEditorState(FORM_TYPE, ncrId);
  const [formSaveNote, setFormSaveNote] = useState<string | null>(null);
  const [exportId, setExportId] = useState<string | null>(null);
  const { data: linkedCapaRows = [] } = capaHooks.useList({ ncrId });
  const hasFix = linkedCapaRows.some((capa) => capa.ncrId === ncrId);

  async function handleDownload() {
    try {
      const result = await exportFormPdfResult(FORM_TYPE, ncrId);
      setExportId(result.exportId);
      const blob = new Blob([result.bytes as BlobPart], { type: "application/pdf" });
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

  if (isError) return <p className="text-sm text-destructive">Couldn't load this issue. Refresh the page and try again.</p>;
  if (isLoading || !ncr) return <p className="text-sm text-muted-foreground">Loading this issue…</p>;

  const owner = label(ncr.assignedTo);
  const step = ncrStepKey(ncr.status);
  const closed = step === "closed";
  const stepIndex = ncrLoopIndex(step);
  const stepLabel = ncrStepLabel(step);
  const recorded = ncrRecordedSteps(ncr, history);
  const stepsReadOnly = closed || !canEdit;
  const description = firstLine(values.nonconformanceDescription) || firstLine(ncr.description);
  function saveForm() {
    setFormSaveNote(null);
    void saveNow()
      .then(() => setFormSaveNote("Form saved"))
      .catch(() => setFormSaveNote("Couldn't save this form."));
  }

  return (
    <FormSignProvider formType={FORM_TYPE} entityId={ncrId}>
    <PictureRecordProvider entityType="ncr" entityId={ncrId}>
    <RecordFrame
      header={<RecordGlance
        crumbs={[
          { label: "NCR", to: "/ncr" },
          { label: recordHeading("NCR", ncr.recordNumber) },
        ]}
        title={ncr.title}
        standard={recordHeading("NCR", ncr.recordNumber)}
        numberControl={
          <>
            <RecordNumberEditor
              label="NCR No."
              value={ncr.recordNumber}
              canEdit={canEdit}
              onSave={(next) => {
                const trimmed = next.trim();
                previewField("ncrNumber", trimmed);
                return updateNcr.mutateAsync({ id: ncrId, recordNumber: trimmed || null });
              }}
            />
            <RecordSiteField entity="ncr" id={ncrId} canEdit={canEdit} />
          </>
        }
        stateValue={step}
        stateLabel={stepLabel}
        owner={owner}
        ownerControl={
          canEdit && people.length > 0 ? (
            <select
              aria-label="Owner"
              value={ncr.assignedTo ?? ""}
              onChange={(e) => {
                if (!e.target.value) return;
                updateNcr.mutate({ id: ncrId, assignedTo: Number(e.target.value) });
              }}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            >
              {!ncr.assignedTo && <option value="">Unassigned</option>}
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {formatPerson(person)}
                </option>
              ))}
            </select>
          ) : undefined
        }
        due={duePhrase(ncr.dueDate, closed)}
        dueLate={isPastDue(ncr.dueDate, closed)}
        dueControl={
          canEdit ? (
            <input
              type="date"
              aria-label="Due date"
              value={ncr.dueDate ? ncr.dueDate.slice(0, 10) : ""}
              onChange={(e) => updateNcr.mutate({ id: ncrId, dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
          ) : undefined
        }
        blocked={closed ? "Nobody" : owner === "Unassigned" ? "Nobody is assigned" : owner}
        next={ncrNextAction(ncr.status, hasFix)}
        accessNote={permitted ? null : READ_ONLY_REASON}
        actions={
          <>
            <ModuleFormLock mode={formLock.mode} canEdit={permitted} pending={isSaving} onEdit={() => formLock.onEdit()} onSave={saveForm} onLock={formLock.lock} />
            <DeleteRecordButton resource="ncr" id={ncrId} kind="NCR" title={ncr.title} number={ncr.recordNumber} ownerIds={[ncr.createdBy]} navigateTo="/ncr" allowed={permitted} assignedOnly />
            <span className="self-center text-xs text-muted-foreground">{formLoading ? "Loading form…" : isSaving ? "Saving…" : formSaveNote ?? "Saved"}</span>
            <StatusBadge value={ncr.severity} />
            <button onClick={() => setShowHistory(true)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              History
            </button>
            <button onClick={handleDownload} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              Download PDF
            </button>
            <PdfExportActions exportId={exportId} entityType={FORM_TYPE} entityId={ncrId} />
            {quarantineOnHold && step === "verify" && (
              <p className="max-w-sm text-xs text-destructive">{ON_HOLD_BLOCK_MESSAGE}</p>
            )}
            <WorkflowActionButton
              label="Close issue"
              navKey="ncr"
              action={closeAction}
              onClick={() => {
                if (quarantineOnHold) {
                  toast.error(ON_HOLD_BLOCK_MESSAGE);
                  return;
                }
                closeAction.mutate({ id: ncrId }, { onSuccess: rememberStep });
              }}
              visible={step === "verify"}
              variant="primary"
              disabled={quarantineOnHold}
              title={quarantineOnHold ? ON_HOLD_BLOCK_MESSAGE : undefined}
            />
          </>
        }
        trail={<LoopTrail steps={NCR_STEPS} current={ncrLoopIndex(step)} />}
      />}
      related={
        <>
          <NcrStepDocuments ncrId={ncrId} step={step} stepLabel={stepLabel} processData={ncr.processData} canEdit={canEdit && ncr.processData?.locked !== true} />
          <LinkedRecordsPanel ncrId={ncrId} ncrTitle={ncr.title} canEdit={canEdit} />
          <AttachmentsPanel entityType="ncr" entityId={ncrId} title="Attachments" />
        </>
      }
    >
      <RepeatNcrBanner ncrId={ncrId} canEdit={canEdit} />

      <NcrQuarantineSection ncrId={ncrId} canEdit={canEdit} onHoldChange={setQuarantineOnHold} />

      <div className="aq-print-stack grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Left pane — status/linking controls + the real editable form. */}
        <div className="no-print flex flex-col gap-4">
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
            {description ? <p className="text-sm">{description}</p> : null}
            <ActionForm
              label="Containment"
              readOnly={stepsReadOnly}
              value={recorded.containment}
              onSubmit={(value) => containmentAction.mutate({ id: ncrId, containment: value }, { onSuccess: rememberStep })}
              assistant={{
                module: "ncr",
                recordId: ncrId,
                buildPrompt: () =>
                  `Recommend a containment action for ${recordHeading("NCR", ncr.recordNumber)} ("${ncr.title}"). Problem: ${description || "not described"}.` +
                  " Keep it specific and actionable — this is a draft for a quality engineer to review and edit, not a final record.",
              }}
            />
            {stepIndex === 0 && !closed ? (
              <p className="text-sm text-muted-foreground">Record containment first. The cause and the fix stay locked until the parts are held.</p>
            ) : null}
            {stepIndex > 0 && (
              <div className="border-t border-border pt-4">
                <ActionForm
                  label="Cause"
                  readOnly={stepsReadOnly}
                  value={recorded.cause}
                  onSubmit={(value) => rootCauseAction.mutate({ id: ncrId, rootCause: value }, { onSuccess: rememberStep })}
                  structuredRootCause={stepsReadOnly ? undefined : { ncrId: ncr.id, title: ncr.title, description: ncr.description, containment: ncr.containment }}
                />
              </div>
            )}
            {stepIndex >= 1 && (
              <div className="border-t border-border pt-4">
                <ActionForm
                  label="Disposition"
                  readOnly={stepsReadOnly || stepIndex !== 1}
                  value={recorded.disposition}
                  onSubmit={(value) => dispositionStepAction.mutate({ id: ncrId, note: value.trim() }, { onSuccess: rememberStep })}
                />
                {stepIndex === 1 && !closed ? (
                  <p className="text-xs text-muted-foreground">This moves the NCR to Disposition. Quarantine decisions stay in the section above.</p>
                ) : null}
              </div>
            )}
            {stepIndex >= 2 && (
              <div className="border-t border-border pt-4">
                <ActionForm
                  label="Fix"
                  readOnly={stepsReadOnly}
                  value={recorded.fix}
                  onSubmit={(value) => correctiveActionAction.mutate({ id: ncrId, correctiveAction: value }, { onSuccess: rememberStep })}
                />
              </div>
            )}
            {stepIndex >= 3 && (
              <div className="border-t border-border pt-4">
                <ActionForm
                  label="Verify"
                  readOnly={stepsReadOnly || stepIndex !== 3}
                  value={recorded.verify}
                  onSubmit={(value) => verifyAction.mutate({ id: ncrId, verification: value }, { onSuccess: rememberStep })}
                />
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            {formLoading || !layout ? (
              <p className="text-sm text-muted-foreground">Loading form…</p>
            ) : (
              <GenericFormRenderer layout={layout} data={values} onChange={canEdit ? updateField : () => {}} readOnly={!canEdit} detailSectionNumbers={["0", "3", "4", "5", "6", "7", "8"]} />
            )}
          </div>
        </div>

        {/* Right pane — live read-only recreation, fed the same in-memory state as the left pane's form (no network round trip, no debounce). */}
        <div className="aq-form-copy aq-print-sheet min-w-0 rounded-lg border border-border bg-card p-4 xl:sticky xl:top-4 xl:h-fit">
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
    </RecordFrame>
    </PictureRecordProvider>
    </FormSignProvider>
  );
}

interface NcrRootCauseSuggestion {
  rootCause: string;
  confidence: number;
  reasoning: string;
  suggestedCorrectiveActions: string[];
}

function firstLine(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}

function ActionForm({
  label,
  value,
  onSubmit,
  assistant,
  structuredRootCause,
  readOnly = false,
}: {
  label: string;
  value: string | null;
  onSubmit: (value: string) => void;
  assistant?: { module: string; recordId: number; buildPrompt: () => string };
  /** Root-cause specific — wires the real, schema-validated /ai/root-cause pipeline (Phase 4 built it, Phase 5 gives it its first real UI) via the standardized accept/reject panel, instead of the free-text assistant every other ActionForm uses. */
  structuredRootCause?: { ncrId: number; title: string; description: string | null; containment: string | null };
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);
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
        {assistant && !readOnly && (
          <AiFieldAssistant module={assistant.module} recordId={assistant.recordId} buildInitialPrompt={assistant.buildPrompt} onInsert={setDraft} />
        )}
        {structuredRootCause && !readOnly && (
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
      <TextAreaField label="" aria-label={label} value={draft} readOnly={readOnly} onChange={(e) => setDraft(e.target.value)} />
      {!readOnly && (
        <button type="submit" className="w-fit rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
          Save
        </button>
      )}
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
function LinkedRecordsPanel({ ncrId, ncrTitle, canEdit }: { ncrId: number; ncrTitle: string; canEdit: boolean }) {
  const navigate = useNavigate();
  const [attachQuery, setAttachQuery] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const { data: capas = [] } = capaHooks.useList({ ncrId });
  const createCapa = capaHooks.useCreate();
  const attachCapa = capaHooks.useUpdate();
  const createEightD = eightDHooks.useCreate();
  const { data: eightDs = [] } = eightDHooks.useList({ ncrId });
  const { data: rmas = [] } = rmaHooks.useList({ linkedNcrId: ncrId });
  const { data: workOrders = [] } = workOrderHooks.useList({ linkedNcrId: ncrId });
  const { data: searchCapas = [] } = capaHooks.useList(attachQuery.trim() ? { q: attachQuery.trim(), limit: 8 } : undefined, { enabled: attachOpen && attachQuery.trim().length > 0 });

  const linkedCapas = capas.filter((c) => c.ncrId === ncrId || (c.repeatNcrIds ?? []).includes(ncrId));
  const linkedEightDs = eightDs.filter((r) => r.ncrId === ncrId);
  const linkedRmas = rmas.filter((r) => r.linkedNcrId === ncrId);
  const linkedWorkOrders = workOrders.filter((w) => w.linkedNcrId === ncrId);
  const attachChoices = searchCapas.filter((c) => c.ncrId !== ncrId && !(c.repeatNcrIds ?? []).includes(ncrId));

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Related records</h3>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
          <NumberedCreateButton
            label="Open a CAPA"
            numberLabel="CAPA No."
            dialogTitle="Open a CAPA"
            pending={createCapa.isPending}
            className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-60"
            onCreate={async (recordNumber) => {
              const created = await createCapa.mutateAsync({ ncrId, recordNumber: recordNumber.trim() || null });
              navigate(`/capa/${created.id}`);
            }}
          />
          )}
          {canEdit && (
          <NumberedCreateButton
            label="Start 8D"
            numberLabel="8D No."
            dialogTitle="Start an 8D"
            pending={createEightD.isPending}
            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-60"
            onCreate={async (recordNumber) => {
              const created = await createEightD.mutateAsync({ ncrId, recordNumber: recordNumber.trim() || null });
              navigate(`/8d/${created.id}`);
            }}
          />
          )}
          {canEdit && (
          <div className="relative">
            <input
              value={attachQuery}
              onChange={(e) => {
                setAttachQuery(e.target.value);
                setAttachOpen(true);
              }}
              onFocus={() => setAttachOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setAttachOpen(false);
              }}
              placeholder="Search CAPAs"
              aria-label="Search CAPAs to attach"
              aria-expanded={attachOpen}
              aria-controls="capa-attach-list"
              className="w-40 rounded-md border border-border bg-transparent px-2 py-1 text-xs"
            />
            {attachOpen && (
              <ul id="capa-attach-list" role="listbox" className="aq-menu absolute right-0 z-20 mt-1 max-h-48 w-64 overflow-auto rounded-md border border-border bg-card p-1 text-foreground shadow-lg">
                {attachChoices.length === 0 && <li className="px-2 py-1 text-xs text-muted-foreground">No matching CAPA</li>}
                {attachChoices.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      role="option"
                      className="w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-muted"
                      onClick={() => {
                        attachCapa.mutate({ id: c.id, ncrId }, { onSuccess: () => { setAttachQuery(""); setAttachOpen(false); } });
                      }}
                    >
                      {recordHeading("CAPA", c.recordNumber)}
                      {c.rootCause ? ` — ${c.rootCause}` : ""}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          )}
          {canEdit && <CreateRiskButton sourceType="NCR" sourceId={ncrId} defaultTitle={`Risk from ${ncrTitle}`} defaultDepartment="quality" defaultCategory="process" />}
        </div>
      </div>

      {linkedCapas.length === 0 && (
        <p className="mb-2 text-sm text-muted-foreground">No CAPA is tied to this NCR yet. Open one so containment doesn't end here.</p>
      )}
      {linkedEightDs.length === 0 && (
        <p className="mb-2 text-sm text-muted-foreground">No 8D report yet. Start one when this NCR needs the eight-step writeup.</p>
      )}

      <ul className="flex flex-col gap-2 text-sm">
        {linkedCapas.map((c) => (
          <li key={`capa-${c.id}`} className="border-b border-border pb-1">
            <button onClick={() => navigate(`/capa/${c.id}`)} className="flex w-full items-center justify-between text-left hover:text-primary">
              <span>{recordHeading("CAPA", c.recordNumber)}</span>
              <StatusBadge value={c.status} label={statusPhrase(c.status)} />
            </button>
          </li>
        ))}
        {linkedEightDs.map((r) => (
          <li key={`8d-${r.id}`} className="border-b border-border pb-1">
            <button onClick={() => navigate(`/8d/${r.id}`)} className="flex w-full items-center justify-between text-left hover:text-primary">
              <span>{recordHeading("8D", r.recordNumber)}</span>
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
              <span>{recordHeading("Work order", w.recordNumber)}</span>
              <StatusBadge value={w.status} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
