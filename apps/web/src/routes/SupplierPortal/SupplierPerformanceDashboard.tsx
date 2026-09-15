import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { StatusBadge } from "../../components/tables/StatusBadge";
import type { SupplierPortalPerformance } from "../../api/types";

/** GET /supplier-portal/performance — real Corrective Action / PPAP figures, honest nulls (not fabricated percentages) when there's nothing to compute from yet. */
export function SupplierPerformanceDashboard({ supplierId }: { supplierId?: number }) {
  const { data, isLoading } = useQuery<SupplierPortalPerformance>({
    queryKey: ["supplier-portal/performance", supplierId ?? "self"],
    queryFn: async () => (await apiClient.get("/supplier-portal/performance", { params: supplierId ? { supplierId } : undefined })).data,
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
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Corrective Actions</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{data.correctiveActionCount}</p>
          <p className="text-xs text-muted-foreground">{data.correctiveActionAcceptedCount} accepted</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">PPAP Submissions</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{data.ppapSubmissionCount}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">PPAP Approval Rate</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{data.ppapApprovalRate !== null ? `${data.ppapApprovalRate}%` : "No data yet"}</p>
        </div>
      </div>
    </div>
  );
}
