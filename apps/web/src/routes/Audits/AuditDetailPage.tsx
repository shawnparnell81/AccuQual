import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Audit } from "../../api/types";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { TextField, SelectField } from "../../components/forms/Field";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { useWorkflowAction } from "../../hooks/useWorkflowAction";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { AiFieldAssistant } from "../../components/shared/AiFieldAssistant";
import { useSetAssistantContext } from "../../hooks/useAssistantContext";

const auditHooks = createResourceHooks<Audit>("audits");

interface AuditItem {
  id: number;
  question: string;
  finding: string | null;
  severity: string | null;
  evidence: string | null;
}

export function AuditDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const auditId = Number(id);
  const historyKey: unknown[][] = [["workflow-history", "audit", auditId]];
  const { data: audit, isLoading } = auditHooks.useOne(auditId);
  useSetAssistantContext("audit", auditId, audit ? audit.name : `Audit #${auditId}`);
  const startAction = useWorkflowAction("audits", "start", { successMessage: "Audit started.", invalidateKeys: historyKey });
  const completeAction = useWorkflowAction("audits", "complete", { successMessage: "Audit marked completed.", invalidateKeys: historyKey });
  const queryClient = useQueryClient();

  const { data: items = [] } = useQuery<AuditItem[]>({
    queryKey: ["audits", auditId, "items"],
    queryFn: async () => (await apiClient.get(`/audits/${auditId}/item`)).data,
  });

  const [item, setItem] = useState({ question: "", finding: "", severity: "observation" });
  const [autoOpened, setAutoOpened] = useState<number | null>(null);

  if (isLoading || !audit) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{audit.name}</h1>
          <StatusBadge value={audit.status} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OpenFormButton formType="audit_plan" entityId={audit.id} title={`Audit #${audit.id} — Audit Plan`} label="Audit Plan" />
          <OpenFormButton formType="audit_checklist" entityId={audit.id} title={`Audit #${audit.id} — Audit Checklist`} label="Audit Checklist" />
          <OpenFormButton formType="lpa" entityId={audit.id} title={`Audit #${audit.id} — Layered Process Audit`} label="Layered Process Audit" />
          <AiFieldAssistant
            module="audit"
            recordId={auditId}
            triggerLabel="Generate Audit Plan"
            buildInitialPrompt={() =>
              `Help plan Audit #${auditId} ("${audit.name}", type: ${audit.type ?? "not set"}). Propose a checklist of areas to audit, suggest` +
              " the overall scope, propose a sampling plan appropriate to that type of audit, and summarize what regulatory or standard" +
              " requirements are typically relevant for an audit like this. Base it on any prior findings noted for this audit. This is a" +
              " draft for the auditor to review and adapt into the real Audit Plan document — not the document itself."
            }
          />
          <WorkflowActionButton
            label="Start Audit"
            navKey="audit"
            action={startAction}
            onClick={() => startAction.mutate({ id: auditId })}
            visible={audit.status === "scheduled"}
            variant="primary"
          />
          <WorkflowActionButton
            label="Mark completed"
            navKey="audit"
            action={completeAction}
            onClick={() => completeAction.mutate({ id: auditId })}
            visible={audit.status === "in_progress"}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Audit Items</h2>
        <ul className="mb-4 flex flex-col gap-2 text-sm">
          {items.length === 0 && <li className="text-muted-foreground">No items yet.</li>}
          {items.map((i) => (
            <li key={i.id} className="border-b border-border pb-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">{i.question}</span>
                <StatusBadge value={i.severity} />
              </div>
              {i.finding && <p className="mt-1 text-muted-foreground">{i.finding}</p>}
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

        <form
          className="grid gap-3 md:grid-cols-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const { data: created } = await apiClient.post(`/audits/${auditId}/item`, item);
            setItem({ question: "", finding: "", severity: "observation" });
            setAutoOpened(created.discrepancyInvestigation?.id ?? null);
            queryClient.invalidateQueries({ queryKey: ["audits", auditId, "items"] });
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
        </form>
      </div>

      <AttachmentsPanel entityType="audit" entityId={auditId} />
      <WorkflowHistoryPanel moduleName="audit" recordId={auditId} />
    </div>
  );
}
