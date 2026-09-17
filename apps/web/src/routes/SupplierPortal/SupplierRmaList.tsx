import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { useCurrentUser } from "../../hooks/useAuth";
import type { Rma } from "../../api/types";

/** Phase 7 task 1 — unlike SupplierNCRList/SupplierCAPAList, `rma` carries a real supplierId FK, so this is a direct list, not a derived join (see supplierPortal.controller.ts's own comment on why it's still a wrapper endpoint rather than /rma directly). */
export function SupplierRmaList({ supplierId }: { supplierId?: number }) {
  const currentUser = useCurrentUser();
  const canOpen = currentUser?.roleName !== "supplier";
  const { data: rows = [], isLoading } = useQuery<Rma[]>({
    queryKey: ["supplier-portal/rma/list", supplierId ?? "self"],
    queryFn: async () => (await apiClient.get("/supplier-portal/rma/list", { params: supplierId ? { supplierId } : undefined })).data,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No RMAs raised against this supplier yet.</p>;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium">RMAs</h3>
      <ul className="flex flex-col gap-2">
        {rows.map((r) =>
          canOpen ? (
            <li key={r.id}>
              <Link to={`/rma/${r.id}`} className="flex items-center justify-between rounded-md border border-border p-2 text-sm hover:bg-muted">
                <span>{r.rmaNumber}</span>
                <StatusBadge value={r.status} />
              </Link>
            </li>
          ) : (
            <li key={r.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
              <span>{r.rmaNumber}</span>
              <StatusBadge value={r.status} />
            </li>
          )
        )}
      </ul>
    </div>
  );
}
