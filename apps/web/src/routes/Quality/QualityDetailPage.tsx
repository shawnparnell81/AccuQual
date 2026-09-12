import { useParams, useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { OpenFormButton } from "../../components/forms/OpenFormButton";

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
  const { data: discrepancy, isLoading } = qualityHooks.useOne(discrepancyId);
  const closeAction = qualityHooks.useAction("close");

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
          {discrepancy.status !== "closed" && (
            <button onClick={() => closeAction.mutate({ id: discrepancyId })} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              Close Investigation
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">{discrepancy.description || "No description provided."}</div>
    </div>
  );
}
