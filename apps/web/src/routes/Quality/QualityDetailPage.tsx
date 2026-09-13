import { useParams, useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { useWorkflowAction, useWorkflowUpdate } from "../../hooks/useWorkflowAction";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";

interface DiscrepancyInvestigation {
  id: number;
  title: string;
  description: string | null;
  severity: string | null;
  status: string;
  autoCreated: boolean;
  sourceAuditId: number | null;
}

const qualityHooks = createResourceHooks<DiscrepancyInvestigation>("quality");

/** Discrepancy investigation detail: the record plus its fillable investigation form. */
export function QualityDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const discrepancyId = Number(id);
  const historyKey: unknown[][] = [["workflow-history", "di", discrepancyId]];
  const { data: discrepancy, isLoading } = qualityHooks.useOne(discrepancyId);
  // Open -> Investigating -> Disposed are generic-PATCH-only on the backend
  // (no dedicated endpoint — see the Transitions/Rules Dictionaries); only
  // Close is a real, sequence-checked, dedicated action.
  const investigateAction = useWorkflowUpdate<{ id: number; status: string }>("quality", { successMessage: "Marked investigating.", invalidateKeys: historyKey });
  const disposeAction = useWorkflowUpdate<{ id: number; status: string }>("quality", { successMessage: "Marked disposed.", invalidateKeys: historyKey });
  const closeAction = useWorkflowAction("quality", "close", { successMessage: "Investigation closed.", invalidateKeys: historyKey });

  if (isLoading || !discrepancy) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            Discrepancy #{discrepancy.id} — {discrepancy.title}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge value={discrepancy.status} />
            <StatusBadge value={discrepancy.severity} />
            {discrepancy.autoCreated && (
              <button onClick={() => navigate(`/audits/${discrepancy.sourceAuditId}`)} className="text-xs text-primary hover:underline">
                Auto-opened from Audit #{discrepancy.sourceAuditId}
              </button>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <OpenFormButton formType="discrepancy_inspection" entityId={discrepancy.id} title={`Discrepancy #${discrepancy.id} Investigation`} />
          <WorkflowActionButton
            label="Mark Investigating"
            navKey="di"
            action={investigateAction}
            onClick={() => investigateAction.mutate({ id: discrepancyId, status: "investigating" })}
            visible={discrepancy.status === "open"}
            variant="primary"
          />
          <WorkflowActionButton
            label="Mark Disposed"
            navKey="di"
            action={disposeAction}
            onClick={() => disposeAction.mutate({ id: discrepancyId, status: "disposed" })}
            visible={discrepancy.status === "investigating"}
            variant="primary"
          />
          <WorkflowActionButton
            label="Close Investigation"
            navKey="di"
            action={closeAction}
            onClick={() => closeAction.mutate({ id: discrepancyId })}
            visible={discrepancy.status === "disposed"}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">{discrepancy.description || "No description provided."}</div>

      <WorkflowHistoryPanel moduleName="di" recordId={discrepancyId} />
    </div>
  );
}
