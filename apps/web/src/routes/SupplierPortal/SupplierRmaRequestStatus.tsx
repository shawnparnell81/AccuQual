import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { StatusBadge } from "../../components/tables/StatusBadge";
import type { SupplierRmaRequest } from "../../api/types";

/**
 * The supplier's own submitted RMA Requests and what happened to each — a
 * real numbered RMA the moment one exists, never a fabricated "processing"
 * state. GET /supplier-portal/rma-request/status is supplier-only (see
 * rmaRequest.controller.ts), so this component only ever renders for a
 * real supplier login — no internal-staff branch needed; internal staff
 * see the same RMA via the real RMA module and /rma-activity-log instead.
 */
export function SupplierRmaRequestStatus() {
  const { data: rows = [], isLoading } = useQuery<SupplierRmaRequest[]>({
    queryKey: ["supplier-portal/rma-request/status"],
    queryFn: async () => (await apiClient.get("/supplier-portal/rma-request/status")).data,
  });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium">Your RMA Requests</h3>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No RMA Requests submitted yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="pb-2">Submitted</th>
              <th className="pb-2">Customer Claim #</th>
              <th className="pb-2">Part #</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">RMA #</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="py-1.5 text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</td>
                <td className="py-1.5">{r.customerClaimNumber ?? "—"}</td>
                <td className="py-1.5">{r.partNumber ?? "—"}</td>
                <td className="py-1.5">
                  <StatusBadge value={r.status} />
                </td>
                <td className="py-1.5 font-medium">{r.createdRmaNumber ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
