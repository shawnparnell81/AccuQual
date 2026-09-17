import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { useCurrentUser } from "../../hooks/useAuth";
import type { QualityInspectionReport } from "../../api/types";

/** Phase 8 task 3 — "supplier-facing visibility: inspection notes." A real, direct supplierId FK join (added this phase), unlike NCR/CAPA's derived-link pattern. */
export function SupplierInspectionList({ supplierId }: { supplierId?: number }) {
  const currentUser = useCurrentUser();
  const canOpen = currentUser?.roleName !== "supplier";
  const { data: rows = [], isLoading } = useQuery<QualityInspectionReport[]>({
    queryKey: ["supplier-portal/inspections/list", supplierId ?? "self"],
    queryFn: async () => (await apiClient.get("/supplier-portal/inspections/list", { params: supplierId ? { supplierId } : undefined })).data,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No inspections recorded against this supplier yet.</p>;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium">Inspections</h3>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => {
          const label = `${r.partMaterialNo ?? `Inspection #${r.id}`} — ${new Date(r.inspectionDate ?? r.createdAt ?? Date.now()).toLocaleDateString()}`;
          const status = r.finalStatus ?? "pending";
          return canOpen ? (
            <li key={r.id}>
              <Link to={`/quality-inspection-reports/${r.id}`} className="flex items-center justify-between rounded-md border border-border p-2 text-sm hover:bg-muted">
                <span>{label}</span>
                <StatusBadge value={status === "rejected" ? "critical" : status} label={status.replace(/_/g, " ")} />
              </Link>
            </li>
          ) : (
            <li key={r.id} className="flex flex-col gap-1 rounded-md border border-border p-2 text-sm">
              <div className="flex items-center justify-between">
                <span>{label}</span>
                <StatusBadge value={status === "rejected" ? "critical" : status} label={status.replace(/_/g, " ")} />
              </div>
              {r.notesRemarks && <p className="text-xs text-muted-foreground">{r.notesRemarks}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
