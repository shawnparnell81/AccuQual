import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { AuditFacts } from "../../components/shared/AuditFacts";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { useCurrentUser } from "../../hooks/useAuth";
import { formatDateTime } from "../../lib/dates";
import type { AuditFieldChange } from "../../lib/auditLine";
import { canViewAuditLog } from "../../lib/recordDelete";

interface AuditRow {
  id: number;
  entityType: string;
  entityId: number;
  action: string;
  changes: Record<string, unknown> | null;
  fieldChanges?: AuditFieldChange[] | null;
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
        <p className="text-sm text-muted-foreground">Who changed a record you can open, what they did, when, and a short description. Sign-in and account history for other people stays with an Owner or Administrator.</p>
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
              <AuditFacts entry={row} when={formatDateTime(row.createdAt)} whenIso={row.createdAt} record={`${row.entityType} #${row.entityId}`} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
