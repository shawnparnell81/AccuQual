import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";

interface ScorecardEntry {
  id: number;
  period: string | null;
  qualityScore: string | null;
  deliveryScore: string | null;
  overallScore: string | null;
  notes: string | null;
  createdAt: string;
}

/** Reads the existing, already-real supplierScorecards table (see supplier.controller.ts's addScorecardHandler) — a read-only self-service view onto data that already has a home, not a second scoring system. */
export function SupplierScorecard({ supplierId }: { supplierId?: number }) {
  const { data: rows = [], isLoading } = useQuery<ScorecardEntry[]>({
    queryKey: ["supplier-portal/scorecard", supplierId ?? "self"],
    queryFn: async () => (await apiClient.get("/supplier-portal/scorecard", { params: supplierId ? { supplierId } : undefined })).data,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No scorecard entries recorded yet.</p>;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium">Scorecard History</h3>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="pb-2">Period</th>
            <th className="pb-2">Quality</th>
            <th className="pb-2">Delivery</th>
            <th className="pb-2">Overall</th>
            <th className="pb-2">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="py-1.5 font-medium">{r.period ?? "—"}</td>
              <td className="py-1.5 tabular-nums">{r.qualityScore ?? "—"}</td>
              <td className="py-1.5 tabular-nums">{r.deliveryScore ?? "—"}</td>
              <td className="py-1.5 tabular-nums font-medium">{r.overallScore ?? "—"}</td>
              <td className="py-1.5 text-muted-foreground">{r.notes ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
