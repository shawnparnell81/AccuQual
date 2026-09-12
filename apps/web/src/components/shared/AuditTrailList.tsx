import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";

interface AuditEntry {
  id: number;
  action: string;
  changes: Record<string, unknown> | null;
  performedBy: number | null;
  createdAt: string;
}

function summarizeChanges(changes: Record<string, unknown> | null): string {
  if (!changes) return "";
  return Object.entries(changes)
    .filter(([k, v]) => k !== "action" && v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
}

/**
 * GET /audit-trail/:entityType/:entityId, rendered as a compact list — the
 * one place this shape of query+render exists, used by every module's
 * history panel (Document, Training, ...) instead of each hand-rolling its
 * own copy. `entityType` must match exactly what that module's controller
 * passed to recordAuditTrail (e.g. "Document", "TrainingAssignment") — see
 * audit-trail.routes.ts, which matches it case-sensitively.
 */
export function AuditTrailList({ entityType, entityId }: { entityType: string; entityId: number }) {
  const { data: entries = [] } = useQuery<AuditEntry[]>({
    queryKey: ["audit-trail", entityType, entityId],
    queryFn: async () => (await apiClient.get(`/audit-trail/${entityType}/${entityId}`)).data,
  });

  const sorted = [...entries].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {sorted.length === 0 && <li className="text-muted-foreground">No audit entries yet.</li>}
      {sorted.map((entry) => (
        <li key={entry.id} className="flex items-center justify-between border-b border-border pb-1.5 last:border-0 text-xs">
          <span className="font-medium capitalize">{(entry.changes?.action as string) ?? entry.action}</span>
          <span className="flex-1 px-2 text-muted-foreground">{summarizeChanges(entry.changes)}</span>
          <span className="flex-none text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}
