import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { StatusBadge } from "../../components/tables/StatusBadge";
import type { InventoryLot } from "../../api/types";

interface SupplierLot extends InventoryLot {
  /** The originating receiving line item's own disposition — a lot has no accept/reject status of its own (see erp.ts's schema comment). */
  receivingStatus: string | null;
}

/** Phase 8 task 3 — "supplier-facing visibility: accepted lots, rejected lots." */
export function SupplierLotList({ supplierId }: { supplierId?: number }) {
  const { data: rows = [], isLoading } = useQuery<SupplierLot[]>({
    queryKey: ["supplier-portal/lots/list", supplierId ?? "self"],
    queryFn: async () => (await apiClient.get("/supplier-portal/lots/list", { params: supplierId ? { supplierId } : undefined })).data,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No shipment lots recorded for this supplier yet.</p>;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium">Shipment Lots</h3>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="pb-2">Lot #</th>
            <th className="pb-2">Received</th>
            <th className="pb-2">Remaining</th>
            <th className="pb-2">Received On</th>
            <th className="pb-2">Disposition</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id} className="border-t border-border">
              <td className="py-1.5 font-medium">{l.lotNumber}</td>
              <td className="py-1.5 tabular-nums">{l.receivedQty}</td>
              <td className="py-1.5 tabular-nums">{l.remainingQty}</td>
              <td className="py-1.5 text-muted-foreground">{new Date(l.createdAt).toLocaleDateString()}</td>
              <td className="py-1.5">
                {l.receivingStatus ? (
                  <StatusBadge value={l.receivingStatus === "rejected" || l.receivingStatus === "quarantined" ? "critical" : l.receivingStatus} label={l.receivingStatus.replace(/_/g, " ")} />
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
