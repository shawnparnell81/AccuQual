import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { useCurrentUser } from "../../hooks/useAuth";
import type { Ncr } from "../../api/types";

/** Read-only NCR visibility, derived from real links (an RMA/warranty claim against this supplier, or a CAR/8D response this supplier already submitted) — NOT a new supplierId column on ncr itself (no schema/workflow change to the existing NCR module). Internal staff get a real link into the NCR module; a supplier login just sees the summary (it has no access to /ncr itself). */
export function SupplierNCRList({ supplierId }: { supplierId?: number }) {
  const currentUser = useCurrentUser();
  const canOpenNcr = currentUser?.roleName !== "supplier";
  const { data: rows = [], isLoading } = useQuery<Ncr[]>({
    queryKey: ["supplier-portal/ncr/list", supplierId ?? "self"],
    queryFn: async () => (await apiClient.get("/supplier-portal/ncr/list", { params: supplierId ? { supplierId } : undefined })).data,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No NCRs linked to this supplier yet.</p>;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium">Linked NCRs</h3>
      <ul className="flex flex-col gap-2">
        {rows.map((n) =>
          canOpenNcr ? (
            <li key={n.id}>
              <Link to={`/ncr/${n.id}`} className="flex items-center justify-between rounded-md border border-border p-2 text-sm hover:bg-muted">
                <span>
                  NCR #{n.id} — {n.title}
                </span>
                <StatusBadge value={n.status} />
              </Link>
            </li>
          ) : (
            <li key={n.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
              <span>
                NCR #{n.id} — {n.title}
              </span>
              <StatusBadge value={n.status} />
            </li>
          )
        )}
      </ul>
    </div>
  );
}
