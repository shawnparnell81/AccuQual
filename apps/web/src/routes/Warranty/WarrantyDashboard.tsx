import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../../api/client";
import { StatusBadge } from "../../components/tables/StatusBadge";
import type { WarrantyAnalytics } from "../../api/types";

/** GET /warranty/analytics — real counts/cost totals/average time-in-status, no fabricated figures (an empty tenant shows real zeros, not sample data). */
export function WarrantyDashboard() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery<WarrantyAnalytics>({
    queryKey: ["warranty/analytics"],
    queryFn: async () => (await apiClient.get("/warranty/analytics")).data,
  });

  if (isLoading || !data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const statuses = Object.entries(data.byStatus) as [string, number][];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Warranty Dashboard</h1>
        <button onClick={() => navigate("/warranty")} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
          All Claims
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total Claims</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{data.totalClaims}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total Estimated Cost</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">${data.totalCostEstimate.toFixed(2)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total Actual Cost</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">${data.totalActualCost.toFixed(2)}</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Claims by Status</h3>
        {statuses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No claims yet.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {statuses.map(([status, count]) => (
              <div key={status} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                <StatusBadge value={status} />
                <span className="text-sm font-medium tabular-nums">{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Average Time in Status</h3>
        {Object.keys(data.averageDaysInStatus).length === 0 ? (
          <p className="text-sm text-muted-foreground">Not enough completed transitions yet to compute this.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-2">Status</th>
                <th className="pb-2">Average Days</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.averageDaysInStatus).map(([status, days]) => (
                <tr key={status} className="border-t border-border">
                  <td className="py-1.5">
                    <StatusBadge value={status} />
                  </td>
                  <td className="py-1.5 tabular-nums">{days} days</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
