import { useState, type DragEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Audit } from "../../api/types";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { TextField, TextAreaField, SelectField } from "../../components/forms/Field";
import { SaveStatus } from "../../components/shared/SaveStatus";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { useWorkflowAction, extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useToast } from "../../components/shared/ToastProvider";
import { GripVertical } from "lucide-react";
import { dropPosition, reorderDropClass, reorderIds } from "../../lib/listReorder";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { DeleteRecordButton } from "../../components/shared/DeleteRecordButton";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { AiFieldAssistant } from "../../components/shared/AiFieldAssistant";
import { AiStructuredSuggestion } from "../../components/shared/AiStructuredSuggestion";
import { RecordNumberEditor } from "../../components/forms/RecordNumberField";
import { recordHeading } from "../../lib/userRecordNumber";
import { useCanEditWorkflow } from "../../hooks/useWorkflowAccess";
import { useModuleFormLock } from "../../hooks/useSavedFormMode";
import { ModuleFormLock } from "../../components/forms/SavedFormLockBar";
import { useSetAssistantContext } from "../../hooks/useAssistantContext";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";

const auditHooks = createResourceHooks<Audit>("audits");

interface AuditItem {
  id: number;
  question: string;
  finding: string | null;
  severity: string | null;
  evidence: string | null;
}

interface AuditPrepSuggestion {
  focusAreas: string[];
  openRisks: string[];
  suggestedEvidence: string[];
}

interface AuditDetailPageProps {
  /** When set (embedded in a window), used instead of the route's :id param. */
  entityId?: number;
}

export function AuditDetailPage({ entityId }: AuditDetailPageProps = {}) {
  const { id } = useParams();
  const navigate = useNavigate();
  const auditId = entityId ?? Number(id);
  const historyKey: unknown[][] = [["workflow-history", "audit", auditId]];
  const { data: audit, isLoading, isError } = auditHooks.useOne(auditId);
  const updateAudit = auditHooks.useUpdate();
  const permitted = useCanEditWorkflow("audit");
  const formLock = useModuleFormLock(auditId, permitted, `/audits/${auditId}/begin-edit`);
  const canEdit = formLock.fieldsEditable;
  useSetAssistantContext("audit", auditId, audit ? recordHeading("Audit", audit.recordNumber) : "Audit");
  const startAction = useWorkflowAction("audits", "start", { successMessage: "Audit started.", invalidateKeys: historyKey });
  const completeAction = useWorkflowAction("audits", "complete", { successMessage: "Audit marked completed.", invalidateKeys: historyKey });
  const queryClient = useQueryClient();

  const { data: items = [] } = useQuery<AuditItem[]>({
    queryKey: ["audits", auditId, "items"],
    queryFn: async () => (await apiClient.get(`/audits/${auditId}/item`)).data,
  });

  const [item, setItem] = useState({ question: "", finding: "", severity: "observation" });
  const [headerSaving, setHeaderSaving] = useState(false);
  const [headerSaved, setHeaderSaved] = useState(false);
  const [autoOpened, setAutoOpened] = useState<number | null>(null);
  const toast = useToast();
  const [dragItemId, setDragItemId] = useState<number | null>(null);
  const [overItem, setOverItem] = useState<{ id: number; position: "before" | "after" } | null>(null);

  async function dropItem(targetId: number, position: "before" | "after") {
    const movingId = dragItemId;
    setDragItemId(null);
    setOverItem(null);
    if (movingId === null || movingId === targetId) return;
    const order = reorderIds(
      items.map((i) => i.id),
      movingId,
      targetId,
      position,
    );
    if (!order) return;
    // Show the new order immediately; the server's answer replaces it.
    queryClient.setQueryData<AuditItem[]>(["audits", auditId, "items"], (current = []) => order.map((id) => current.find((i) => i.id === id)!).filter(Boolean));
    try {
      await apiClient.post(`/audits/${auditId}/item/reorder`, { ids: order });
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't reorder the checklist."));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["audits", auditId, "items"] });
    }
  }

  if (isError) return <p className="text-sm text-destructive">Couldn't load this record — try refreshing the page.</p>;
  if (isLoading || !audit) return <LoadingPlaceholder />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{audit.name}</h1>
          <RecordNumberEditor label="Audit No." value={audit.recordNumber} canEdit={canEdit} onSave={(next) => updateAudit.mutateAsync({ id: audit.id, recordNumber: next.trim() || null })} />
          <StatusBadge value={audit.status} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ModuleFormLock
            mode={formLock.mode}
            canEdit={permitted}
            pending={headerSaving}
            onEdit={() => formLock.onEdit()}
            onSave={() => {
              setHeaderSaving(true);
              void apiClient.post(`/audits/${auditId}/save`).then(() => {
                setHeaderSaved(true);
                setHeaderSaving(false);
                void queryClient.invalidateQueries({ queryKey: ["workflow-history", "audit", auditId] });
              }).catch(() => setHeaderSaving(false));
            }}
            onLock={formLock.lock}
          />
          {headerSaved && <SaveStatus saving={headerSaving} unsaved={false} />}
          <DeleteRecordButton resource="audits" id={auditId} kind="Audit" title={audit.name} number={audit.recordNumber} ownerIds={[audit.auditorId]} navigateTo="/audits" allowed={permitted} assignedOnly />
          <OpenFormButton formType="audit_plan" entityId={audit.id} title={`${recordHeading("Audit", audit.recordNumber)} — Audit Plan`} label="Audit Plan" />
          <OpenFormButton formType="audit_checklist" entityId={audit.id} title={`${recordHeading("Audit", audit.recordNumber)} — Audit Checklist`} label="Audit Checklist" />
          <OpenFormButton formType="lpa" entityId={audit.id} title={`${recordHeading("Audit", audit.recordNumber)} — Layered Process Audit`} label="Layered Process Audit" />
          <AiFieldAssistant
            module="audit"
            recordId={auditId}
            triggerLabel="Generate Audit Plan"
            buildInitialPrompt={() =>
              `Help plan ${recordHeading("Audit", audit.recordNumber)} ("${audit.name}", type: ${audit.type ?? "not set"}). Propose a checklist of areas to audit, suggest` +
              " the overall scope, propose a sampling plan appropriate to that type of audit, and summarize what regulatory or standard" +
              " requirements are typically relevant for an audit like this. Base it on any prior findings noted for this audit. This is a" +
              " draft for the auditor to review and adapt into the real Audit Plan document — not the document itself."
            }
          />
          <AiStructuredSuggestion<AuditPrepSuggestion>
            endpoint="/ai/analysis"
            title="AI Audit Prep Summary"
            triggerLabel="AI Prep Summary"
            acceptLabel="Acknowledge"
            buildPayload={() => ({
              kind: "audit_prep",
              input: {
                auditName: audit.name,
                auditType: audit.type,
                status: audit.status,
                items: items.map((i) => ({ question: i.question, finding: i.finding, severity: i.severity })),
              },
            })}
            // No onAccept — this is a non-authoritative summary (logged in
            // ai_suggestions for traceability, per Phase 5's own "stored as
            // non-authoritative notes" requirement), never written into any
            // real audit field.
            renderPreview={(output) => (
              <div className="flex flex-col gap-3 text-sm">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Focus Areas</p>
                  <ul className="list-inside list-disc">
                    {output.focusAreas.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Open Risks</p>
                  <ul className="list-inside list-disc">
                    {output.openRisks.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Suggested Evidence to Have Ready</p>
                  <ul className="list-inside list-disc">
                    {output.suggestedEvidence.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          />
          <WorkflowActionButton
            label="Start Audit"
            navKey="audit"
            action={startAction}
            onClick={() => startAction.mutate({ id: auditId })}
            visible={canEdit && audit.status === "scheduled"}
            variant="primary"
          />
          <WorkflowActionButton
            label="Mark completed"
            navKey="audit"
            action={completeAction}
            onClick={() => completeAction.mutate({ id: auditId })}
            visible={canEdit && audit.status === "in_progress"}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Audit Items</h2>
        <ul className="mb-4 flex flex-col gap-2 text-sm">
          {items.length === 0 && <li className="text-muted-foreground">No items yet.</li>}
          {items.map((i) => (
            <li
              key={i.id}
              className={`border-b border-border pb-2 transition-colors ${overItem?.id === i.id && dragItemId !== i.id ? reorderDropClass(overItem.position) : ""} ${dragItemId === i.id ? "opacity-40" : ""}`}
              onDragOver={(e) => {
                if (dragItemId === null || dragItemId === i.id) return;
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const position = dropPosition(e.clientY, rect.top, rect.height, false);
                if (position === "inside") return;
                setOverItem({ id: i.id, position });
              }}
              onDragLeave={() => setOverItem((current) => (current?.id === i.id ? null : current))}
              onDrop={(e) => {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const position = dropPosition(e.clientY, rect.top, rect.height, false);
                if (position === "inside") return;
                void dropItem(i.id, position);
              }}
            >
              <AuditItemRow
                item={i}
                auditId={auditId}
                canEdit={canEdit}
                canReorder={audit.status !== "completed" && items.length > 1}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", String(i.id));
                  const row = (event.currentTarget as HTMLElement).closest("li");
                  if (row) event.dataTransfer.setDragImage(row, 10, 10);
                  setDragItemId(i.id);
                }}
                onDragEnd={() => {
                  setDragItemId(null);
                  setOverItem(null);
                }}
                onSaved={() => {
                  void queryClient.invalidateQueries({ queryKey: ["audits", auditId, "items"] });
                  void queryClient.invalidateQueries({ queryKey: ["workflow-history", "audit", auditId] });
                }}
              />
            </li>
          ))}
        </ul>

        {autoOpened !== null && (
          <div className="mb-3 flex items-center justify-between rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
            <span>Nonconformance logged — Discrepancy Investigation #{autoOpened} was opened automatically.</span>
            <button onClick={() => navigate(`/quality/${autoOpened}`)} className="font-medium hover:underline">
              View investigation
            </button>
          </div>
        )}

        {canEdit && <form
          className="grid gap-3 md:grid-cols-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const { data: created } = await apiClient.post(`/audits/${auditId}/item`, item);
            setItem({ question: "", finding: "", severity: "observation" });
            setAutoOpened(created.discrepancyInvestigation?.id ?? null);
            queryClient.invalidateQueries({ queryKey: ["audits", auditId, "items"] });
            void queryClient.invalidateQueries({ queryKey: ["workflow-history", "audit", auditId] });
          }}
        >
          <TextField label="Question" value={item.question} onChange={(e) => setItem({ ...item, question: e.target.value })} required />
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Finding</span>
              {item.finding.trim() && (
                <AiFieldAssistant
                  module="audit_finding"
                  recordId={auditId}
                  triggerLabel="Classify Finding"
                  buildInitialPrompt={() =>
                    `Classify this audit finding: "${item.finding}"${item.question ? ` (from the question: "${item.question}")` : ""}. ` +
                    "Suggest a severity (observation, minor, major, or critical — AccuQual's real values, use exactly one), a category" +
                    " (e.g. process, documentation, training, supplier), a risk level, and a few recommended follow-up actions. Note any" +
                    " similar past findings given in context and whether this looks like a recurrence."
                  }
                />
              )}
            </div>
            <TextField label="" value={item.finding} onChange={(e) => setItem({ ...item, finding: e.target.value })} />
          </div>
          <SelectField label="Severity" value={item.severity} onChange={(e) => setItem({ ...item, severity: e.target.value })}>
            {["observation", "minor", "major", "critical"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </SelectField>
          <button type="submit" className="col-span-full w-fit rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
            Add item
          </button>
        </form>}
      </div>

      <AttachmentsPanel entityType="audit" entityId={auditId} />
      <WorkflowHistoryPanel moduleName="audit" recordId={auditId} />
    </div>
  );
}

function AuditItemRow({
  item,
  auditId,
  canEdit,
  canReorder,
  onDragStart,
  onDragEnd,
  onSaved,
}: {
  item: AuditItem;
  auditId: number;
  canEdit: boolean;
  canReorder: boolean;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ question: item.question, finding: item.finding ?? "", severity: item.severity ?? "observation" });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await apiClient.patch(`/audits/${auditId}/item/${item.id}`, {
        question: draft.question.trim(),
        finding: draft.finding.trim() || null,
        severity: draft.severity,
      });
      setEditing(false);
      onSaved();
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't update this item."));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    try {
      await apiClient.delete(`/audits/${auditId}/item/${item.id}`);
      onSaved();
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't remove this item."));
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="grid gap-2">
        <TextField label="Question" value={draft.question} onChange={(event) => setDraft({ ...draft, question: event.target.value })} required />
        <TextAreaField label="Finding" value={draft.finding} rows={3} onChange={(event) => setDraft({ ...draft, finding: event.target.value })} />
        <SelectField label="Severity" value={draft.severity} onChange={(event) => setDraft({ ...draft, severity: event.target.value })}>
          {["observation", "minor", "major", "critical"].map((severity) => (
            <option key={severity} value={severity}>
              {severity}
            </option>
          ))}
        </SelectField>
        <div className="flex gap-2">
          <button type="button" disabled={saving || draft.question.trim() === ""} onClick={() => void save()} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
            Save item
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setDraft({ question: item.question, finding: item.finding ?? "", severity: item.severity ?? "observation" });
              setEditing(false);
            }}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 font-medium">
          {canReorder && (
            <span
              draggable
              title="Drag to reorder"
              className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            >
              <GripVertical size={15} />
            </span>
          )}
          <span className="truncate">{item.question}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <StatusBadge value={item.severity} />
          {canEdit && (
            <>
              <button type="button" onClick={() => setEditing(true)} className="text-sm text-primary hover:underline">
                Edit
              </button>
              <button type="button" disabled={saving} onClick={() => void remove()} className="text-sm text-destructive hover:underline disabled:opacity-60">
                Remove
              </button>
            </>
          )}
        </span>
      </div>
      {item.finding && <p className="mt-1 text-muted-foreground">{item.finding}</p>}
    </>
  );
}
