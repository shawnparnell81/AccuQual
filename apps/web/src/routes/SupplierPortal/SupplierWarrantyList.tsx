import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { useCurrentUser } from "../../hooks/useAuth";
import type { WarrantyClaim } from "../../api/types";

/** Phase 7 task 1 — warrantyClaims carries a real (nullable, set once the claim moves to the supplier) supplierId FK, same direct-list shape as SupplierRmaList. */
export function SupplierWarrantyList({ supplierId }: { supplierId?: number }) {
  const currentUser = useCurrentUser();
  const canOpen = currentUser?.roleName !== "supplier";
  const { data: rows = [], isLoading } = useQuery<WarrantyClaim[]>({
    queryKey: ["supplier-portal/warranty/list", supplierId ?? "self"],
    queryFn: async () => (await apiClient.get("/supplier-portal/warranty/list", { params: supplierId ? { supplierId } : undefined })).data,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No warranty claims linked to this supplier yet.</p>;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium">Warranty Claims</h3>
      <ul className="flex flex-col gap-2">
        {rows.map((c) =>
          canOpen ? (
            <li key={c.id}>
              <Link to={`/warranty/${c.id}`} className="flex items-center justify-between rounded-md border border-border p-2 text-sm hover:bg-muted">
                <span>{c.claimNumber}</span>
                <StatusBadge value={c.status} />
              </Link>
            </li>
          ) : (
            <li key={c.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
              <span>{c.claimNumber}</span>
              <StatusBadge value={c.status} />
            </li>
          )
        )}
      </ul>
    </div>
  );
}
