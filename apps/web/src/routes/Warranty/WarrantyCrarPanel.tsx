import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useWorkflowAccessLevel } from "../../hooks/useWorkflowAccess";
import { StatusBadge } from "../../components/tables/StatusBadge";
import type { CrarClaim } from "../../api/types";

/**
 * Module 4's "Add CRAR tab inside WarrantyClaimDetail.tsx" — lets Quality
 * open (or start) the Customer Return Analysis Report tied to this warranty
 * claim, and lets Customer Service view whichever one already exists.
 * Deliberately thin: CRAR itself is owned by crar.controller.ts/CrarDetailPage,
 * this panel only lists/links, matching how RMA/Work Order links are surfaced
 * elsewhere on this page rather than duplicating that page's own UI here.
 *
 * "warranty.crar.write" (module-specific RBAC build, 2026-09-16) maps
 * directly onto CRAR's own live "edit" level rather than a separate,
 * redundant permission key — creating a CRAR from a warranty claim is
 * exactly the same permission as creating one anywhere else in the app.
 * This used to be a hardcoded `isAdmin || department === "quality"` check
 * passed in as a prop, completely bypassing whatever the Roles &
 * Permissions module's own crar access level actually said; now it's the
 * same live, DB-driven check crar.controller.ts itself enforces, computed
 * here instead of by the caller.
 */
export function WarrantyCrarPanel({ claimId }: { claimId: number }) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canCreate = useWorkflowAccessLevel("crar") === "edit";

  const { data: rows = [], isLoading } = useQuery<CrarClaim[]>({
    queryKey: ["crar", { warrantyId: claimId }],
    queryFn: async () => (await apiClient.get("/crar", { params: { warrantyId: claimId } })).data,
  });

  const createCrar = useMutation({
    mutationFn: async () => (await apiClient.post("/crar", { warrantyId: claimId })).data as CrarClaim,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["crar", { warrantyId: claimId }] });
      navigate(`/crar/${created.id}`);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't start a new CRAR for this claim.")),
  });

  return (
    <div className="rounded-lg border border-border bg-card p-4 print:hidden">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Customer Return Analysis Report</h3>
        {canCreate && (
          <button
            onClick={() => createCrar.mutate()}
            disabled={createCrar.isPending}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createCrar.isPending ? "Starting…" : "+ Start CRAR"}
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No CRAR started for this claim yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5 text-sm">
          {rows.map((c) => (
            <li key={c.id} className="flex items-center justify-between border-b border-border pb-1.5 last:border-0">
              <button onClick={() => navigate(`/crar/${c.id}`)} className="text-left text-primary hover:underline">
                {c.customerClaim ? `Claim ${c.customerClaim}` : `CRAR #${c.id}`}
              </button>
              <StatusBadge value={c.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
