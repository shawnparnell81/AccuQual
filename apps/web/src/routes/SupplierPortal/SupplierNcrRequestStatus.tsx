import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { useCurrentUser } from "../../hooks/useAuth";
import type { SupplierNcrRequest } from "../../api/types";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { FRM_NCR_PATH } from "../../lib/qualityEntry";

/** Supplier logins see their own requests. Staff see the supplier they picked, or every request when none is picked. */
export function SupplierNcrRequestStatus({ supplierId }: { supplierId?: number }) {
  const currentUser = useCurrentUser();
  const isSupplier = currentUser?.roleName === "supplier";
  const { data: rows = [], isLoading } = useQuery<SupplierNcrRequest[]>({
    queryKey: ["supplier-portal/ncr-request", supplierId ?? "self"],
    queryFn: async () => (await apiClient.get("/supplier-portal/ncr-request", { params: !isSupplier && supplierId ? { supplierId } : undefined })).data,
  });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{isSupplier ? "Your NCR requests" : "NCR requests"}</h3>
        {!isSupplier && (
          <Link to={FRM_NCR_PATH} className="text-sm text-primary hover:underline">
            Open the NCR form
          </Link>
        )}
      </div>
      {isLoading ? (
        <LoadingPlaceholder />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No NCR requests yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium">{row.shortDescription || "NCR request"}</p>
                <p className="text-muted-foreground">
                  {[!isSupplier ? row.companyName : null, row.partNumber ? `Part ${row.partNumber}` : null, new Date(row.createdAt).toLocaleDateString()].filter(Boolean).join(" · ")}
                </p>
              </div>
              <StatusBadge value={row.status === "submitted" ? "submitted" : row.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
