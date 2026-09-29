import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { useCurrentUser } from "../../hooks/useAuth";
import { formatDateTime } from "../../lib/dates";
import { auditEventLabel, canViewAuditLog } from "../../lib/recordDelete";

interface AuditRow {
  id: number;
  entityType: string;
  entityId: number;
  action: string;
  changes: Record<string, unknown> | null;
  performedByName: string | null;
  createdAt: string;
}

export function AuditLogPage() {
  const user = useCurrentUser();
  const allowed = canViewAuditLog(user?.roleName);
  const { data: rows = [], isLoading, isError } = useQuery<AuditRow[]>({
    queryKey: ["audit-trail", "recent"],
    queryFn: async () => (await apiClient.get("/audit-trail")).data,
    enabled: allowed,
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">Who changed or deleted a record you can open, and when.</p>
      </div>
      {isLoading ? (
        <LoadingPlaceholder />
      ) : isError ? (
        <p className="text-sm text-destructive">Couldn't load the audit log.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No history yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-lg border border-border bg-card px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className={row.action === "delete" ? "font-medium text-destructive" : "font-medium"}>{auditEventLabel(row)}</span>
                <span className="text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {row.performedByName ?? "System"} · {row.entityType} #{row.entityId}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
