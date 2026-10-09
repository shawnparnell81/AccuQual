import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { useCurrentUser } from "../../hooks/useAuth";
import type { Capa } from "../../api/types";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { recordHeading } from "../../lib/userRecordNumber";

/** Same derived-visibility approach as SupplierNCRList — see supplierPortal.controller.ts's supplierCapaListHandler. */
export function SupplierCAPAList({ supplierId }: { supplierId?: number }) {
  const currentUser = useCurrentUser();
  const canOpenCapa = currentUser?.roleName !== "supplier";
  const { data: rows = [], isLoading } = useQuery<Capa[]>({
    queryKey: ["supplier-portal/capa/list", supplierId ?? "self"],
    queryFn: async () => (await apiClient.get("/supplier-portal/capa/list", { params: supplierId ? { supplierId } : undefined })).data,
  });

  if (isLoading) return <LoadingPlaceholder />;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No CAPAs linked to this supplier yet.</p>;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium">Linked CAPAs</h3>
      <ul className="flex flex-col gap-2">
        {rows.map((c) =>
          canOpenCapa ? (
            <li key={c.id}>
              <Link to={`/capa/${c.id}`} className="flex items-center justify-between rounded-md border border-border p-2 text-sm hover:bg-muted">
                <span>{recordHeading("CAPA", c.recordNumber)} — {c.rootCause ?? "No root cause recorded"}</span>
                <StatusBadge value={c.status} />
              </Link>
            </li>
          ) : (
            <li key={c.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
              <span>{recordHeading("CAPA", c.recordNumber)} — {c.rootCause ?? "No root cause recorded"}</span>
              <StatusBadge value={c.status} />
            </li>
          )
        )}
      </ul>
    </div>
  );
}
