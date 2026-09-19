import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { SelectField } from "../../components/forms/Field";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { PrintFormButton } from "../../components/forms/PrintFormButton";
import { useToast } from "../../components/shared/ToastProvider";
import { useWorkflowAction, useWorkflowUpdate } from "../../hooks/useWorkflowAction";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";

interface DiscrepancyInvestigation {
  id: number;
  title: string;
  description: string | null;
  severity: string | null;
  status: string;
  disposition: string | null;
  autoCreated: boolean;
  sourceAuditId: number | null;
}

const DISPOSITIONS: Array<{ value: string; label: string }> = [
  { value: "use-as-is", label: "Use as-is" },
  { value: "rework", label: "Rework" },
  { value: "repair", label: "Repair" },
  { value: "scrap", label: "Scrap" },
  { value: "return-to-supplier", label: "Return to supplier" },
  { value: "sort", label: "Sort" },
];

const qualityHooks = createResourceHooks<DiscrepancyInvestigation>("quality");

/** Discrepancy investigation detail: the record plus its fillable investigation form. */
export function QualityDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const discrepancyId = Number(id);
  const historyKey: unknown[][] = [["workflow-history", "di", discrepancyId]];
  const { data: discrepancy, isLoading, isError } = qualityHooks.useOne(discrepancyId);
  // Status moves only through these dedicated, sequence-checked endpoints
  // (open -> investigating -> disposed -> closed); the generic PATCH no
  // longer accepts `status`.
  const investigateAction = useWorkflowAction("quality", "investigate", { successMessage: "Marked investigating.", invalidateKeys: historyKey });
  const disposeAction = useWorkflowAction<{ id: number; disposition: string }>("quality", "dispose", { successMessage: "Marked disposed.", invalidateKeys: historyKey });
  const closeAction = useWorkflowAction("quality", "close", { successMessage: "Investigation closed.", invalidateKeys: historyKey });
  const saveDisposition = useWorkflowUpdate<{ id: number; disposition: string | null }>("quality", { successMessage: "Disposition saved.", invalidateKeys: historyKey });

  const [disposition, setDisposition] = useState("");
  useEffect(() => setDisposition(discrepancy?.disposition ?? ""), [discrepancy?.disposition]);

  if (isError) return <p className="text-sm text-destructive">Couldn't load this record — try refreshing the page.</p>;
  if (isLoading || !discrepancy) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const closed = discrepancy.status === "closed";

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
          <PrintFormButton formType="discrepancy_inspection" entityId={discrepancy.id} />
          <WorkflowActionButton
            label="Mark Investigating"
            navKey="di"
            action={investigateAction}
            onClick={() => investigateAction.mutate({ id: discrepancyId })}
            visible={discrepancy.status === "open"}
            variant="primary"
          />
          <WorkflowActionButton
            label="Mark Disposed"
            navKey="di"
            action={disposeAction}
            onClick={() => {
              if (!disposition) {
                toast.error("Select a disposition before marking this investigation disposed.");
                return;
              }
              disposeAction.mutate({ id: discrepancyId, disposition });
            }}
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

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-medium">Disposition</h2>
        {closed ? (
          <p className="text-sm">{DISPOSITIONS.find((d) => d.value === discrepancy.disposition)?.label ?? "None"}</p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-64">
              <SelectField label="" value={disposition} onChange={(e) => setDisposition(e.target.value)} aria-label="Disposition">
                <option value="">Not decided</option>
                {DISPOSITIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </SelectField>
            </div>
            <button
              onClick={() => saveDisposition.mutate({ id: discrepancyId, disposition: disposition || null })}
              disabled={saveDisposition.isPending || disposition === (discrepancy.disposition ?? "")}
              className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
            >
              Save disposition
            </button>
            {discrepancy.status === "investigating" && <span className="text-xs text-muted-foreground">Required before this can be marked disposed.</span>}
          </div>
        )}
      </div>

      <WorkflowHistoryPanel moduleName="di" recordId={discrepancyId} />
    </div>
  );
}
