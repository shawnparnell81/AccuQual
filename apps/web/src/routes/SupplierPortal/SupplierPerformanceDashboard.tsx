import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { StatusBadge } from "../../components/tables/StatusBadge";
import type { SupplierPortalPerformance, SupplierQualityFactors } from "../../api/types";

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

/** GET /supplier-portal/performance — real Corrective Action / PPAP figures, honest nulls (not fabricated percentages) when there's nothing to compute from yet. */
export function SupplierPerformanceDashboard({ supplierId }: { supplierId?: number }) {
  const { data, isLoading } = useQuery<SupplierPortalPerformance>({
    queryKey: ["supplier-portal/performance", supplierId ?? "self"],
    queryFn: async () => (await apiClient.get("/supplier-portal/performance", { params: supplierId ? { supplierId } : undefined })).data,
  });
  // Phase 7 task 1/4 — the KPI strip (NCR/CAPA count, on-time delivery %,
  // defect rate, open corrective actions) and task 8's health indicators,
  // both from the one GET /supplier-portal/kpis call — see
  // supplier.qualityRisk.ts's getSupplierQualityFactors/getSupplierHealth.
  const { data: kpis } = useQuery<SupplierQualityFactors>({
    queryKey: ["supplier-portal/kpis", supplierId ?? "self"],
    queryFn: async () => (await apiClient.get("/supplier-portal/kpis", { params: supplierId ? { supplierId } : undefined })).data,
  });

  if (isLoading || !data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">{data.supplier.name}</h3>
          <StatusBadge value={data.supplier.status} />
        </div>
        <p className="text-xs text-muted-foreground">Risk level: {data.supplier.riskLevel ?? "Unrated"}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Corrective Actions" value={String(data.correctiveActionCount)} sub={`${data.correctiveActionAcceptedCount} accepted`} />
        <Kpi label="PPAP Submissions" value={String(data.ppapSubmissionCount)} />
        <Kpi label="PPAP Approval Rate" value={data.ppapApprovalRate !== null ? `${data.ppapApprovalRate}%` : "No data yet"} />
      </div>

      {kpis && (
        <>
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi label="NCR Count" value={String(kpis.ncrCount)} />
            <Kpi label="CAPA Count" value={String(kpis.capaCount)} sub={kpis.capaRecurrenceCount > 0 ? `${kpis.capaRecurrenceCount} recurring` : undefined} />
            <Kpi label="On-Time Delivery" value={kpis.onTimeDeliveryPercent !== null ? `${kpis.onTimeDeliveryPercent}%` : "No data"} />
            <Kpi label="Defect Rate" value={kpis.defectRatePercent !== null ? `${kpis.defectRatePercent}%` : "No data"} />
            <Kpi label="Open Corrective Actions" value={String(kpis.openCorrectiveActionCount)} />
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-medium">Health Indicators</h3>
            <div className="grid gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Last Login</p>
                <p className="text-sm font-medium">{relativeTime(kpis.health.lastLoginAt)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Last Document Upload</p>
                <p className="text-sm font-medium">{relativeTime(kpis.health.lastDocumentUploadAt)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Last Communication</p>
                <p className="text-sm font-medium">{relativeTime(kpis.health.lastCommunicationAt)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Open Actions</p>
                <p className="text-sm font-medium tabular-nums">{kpis.health.openActionCount}</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
