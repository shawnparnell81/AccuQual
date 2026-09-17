import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { useCurrentUser } from "../../hooks/useAuth";
import type { ScarForm } from "../../api/types";

/** Phase 7 task 1 — SCAR (Supplier Corrective Action Request) forms now carry a real, nullable supplierId FK added this phase (see scarForms.ts's schema comment — the pre-existing supplierName field was free text with no reliable join back to a real supplier record). Only SCARs created against a real supplier show up here; older ones typed with just a name won't until re-linked. */
export function SupplierScarList({ supplierId }: { supplierId?: number }) {
  const currentUser = useCurrentUser();
  const canOpen = currentUser?.roleName !== "supplier";
  const { data: rows = [], isLoading } = useQuery<ScarForm[]>({
    queryKey: ["supplier-portal/scar/list", supplierId ?? "self"],
    queryFn: async () => (await apiClient.get("/supplier-portal/scar/list", { params: supplierId ? { supplierId } : undefined })).data,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No SCARs issued to this supplier yet.</p>;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium">SCARs</h3>
      <ul className="flex flex-col gap-2">
        {rows.map((s) =>
          canOpen ? (
            <li key={s.id}>
              <Link to={`/scar-forms/${s.id}`} className="flex items-center justify-between rounded-md border border-border p-2 text-sm hover:bg-muted">
                <span>{s.scarNumber ?? `SCAR #${s.id}`}</span>
                <StatusBadge value={s.status} />
              </Link>
            </li>
          ) : (
            <li key={s.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
              <span>{s.scarNumber ?? `SCAR #${s.id}`}</span>
              <StatusBadge value={s.status} />
            </li>
          )
        )}
      </ul>
    </div>
  );
}
