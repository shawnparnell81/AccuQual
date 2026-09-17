import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { formatDateTime } from "../../lib/dates";

interface AuditRow {
  id: number;
  action: string;
  changes: Record<string, unknown> | null;
  performedByName: string | null;
  createdAt: string;
}

/**
 * A small, generic audit trail viewer for any module whose moduleName isn't
 * in workflow.controller.ts's MODULE_ENTITY_TYPES map (so it can't use the
 * shared WorkflowHistoryPanel) — hits the app's own generic
 * GET /audit-trail/:entityType/:entityId endpoint directly instead.
 * Extracted from RmaLogDetailPage.tsx's own original inline version (Phase 2
 * "Ensure CRAR audit trail shows real actor names" — CRAR had no history
 * display at all before this; RMA Log's was inline and not reusable).
 * performedByName is resolved server-side (see audit-trail.service.ts's
 * withResolvedActors) — never a bare "User #12".
 */
export function EntityAuditTrailPanel({ entityType, entityId, title = "Audit Trail" }: { entityType: string; entityId: number; title?: string }) {
  const { data: rows = [], isLoading } = useQuery<AuditRow[]>({
    queryKey: ["audit-trail", entityType, entityId],
    queryFn: async () => (await apiClient.get(`/audit-trail/${entityType}/${entityId}`)).data,
  });
  const sorted = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="rounded-lg border border-border bg-card p-4 print:hidden">
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">No history yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm">
          {sorted.map((r) => (
            <li key={r.id} className="flex items-center justify-between border-b border-border pb-1.5 last:border-0">
              <span className="capitalize">{r.action.replace(/_/g, " ")}</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{r.performedByName ?? "System"}</span>
                <span>{formatDateTime(r.createdAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
