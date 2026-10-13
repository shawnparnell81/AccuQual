import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { AuditFacts } from "../../components/shared/AuditFacts";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { useCurrentUser } from "../../hooks/useAuth";
import { formatDateTime } from "../../lib/dates";
import type { AuditFieldChange } from "../../lib/auditLine";
import { auditSubject } from "../../lib/userRecordNumber";
import { canViewAuditLog } from "../../lib/recordDelete";
import { auditListParams, EMPTY_AUDIT_FILTERS, type AuditFilters } from "../../lib/auditLogFilters";

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

interface AuditPage {
  rows: AuditRow[];
  nextBefore: number | null;
}

interface AuditFilterOptions {
  entityTypes: string[];
  users: { id: number; name: string }[];
}

const INPUT = "rounded-md border border-border bg-background px-2 py-1.5 text-sm";

export function AuditLogPage() {
  const user = useCurrentUser();
  const allowed = canViewAuditLog(user?.roleName);
  // `draft` is what is typed; `applied` is what the list was last loaded with.
  const [draft, setDraft] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const [applied, setApplied] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);

  const { data: options } = useQuery<AuditFilterOptions>({
    queryKey: ["audit-trail", "filters"],
    queryFn: async () => (await apiClient.get("/audit-trail/filters")).data,
    enabled: allowed,
    staleTime: 60_000,
  });

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<AuditPage>({
    queryKey: ["audit-trail", "recent", applied],
    queryFn: async ({ pageParam }) =>
      (await apiClient.get("/audit-trail", { params: auditListParams(applied, pageParam as number | undefined) })).data,
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last: AuditPage) => last.nextBefore ?? undefined,
    enabled: allowed,
  });
  const rows = data?.pages.flatMap((page) => page.rows) ?? [];
  const isBlank = (value: AuditFilters) => JSON.stringify(value) === JSON.stringify(EMPTY_AUDIT_FILTERS);
  const filtered = !isBlank(applied);
  const set = (key: keyof AuditFilters, value: string) => setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">Who changed a record you can open, what they did, when, and a short description. Sign-in history stays with an Owner or Administrator.</p>
      </div>

      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(draft);
        }}
      >
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          User
          <select id="audit-filter-user" className={INPUT} value={draft.userId} onChange={(e) => set("userId", e.target.value)}>
            <option value="">Everyone</option>
            {(options?.users ?? []).map((person) => (
              <option key={person.id} value={person.id}>{person.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Module / record type
          <select id="audit-filter-type" className={INPUT} value={draft.entityType} onChange={(e) => set("entityType", e.target.value)}>
            <option value="">All</option>
            {(options?.entityTypes ?? []).map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          From
          <input id="audit-filter-from" type="date" className={INPUT} value={draft.from} max={draft.to || undefined} onChange={(e) => set("from", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          To
          <input id="audit-filter-to" type="date" className={INPUT} value={draft.to} min={draft.from || undefined} onChange={(e) => set("to", e.target.value)} />
        </label>
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Search the action
          <input id="audit-filter-q" type="search" className={INPUT} placeholder="e.g. delete, approved" value={draft.q} onChange={(e) => set("q", e.target.value)} />
        </label>
        <button type="submit" className="rounded-md bg-button px-4 py-2 text-sm font-medium text-button-foreground">Apply</button>
        {(filtered || !isBlank(draft)) && (
          <button
            type="button"
            className="rounded-md border border-border px-4 py-2 text-sm"
            onClick={() => {
              setDraft(EMPTY_AUDIT_FILTERS);
              setApplied(EMPTY_AUDIT_FILTERS);
            }}
          >
            Clear
          </button>
        )}
      </form>

      {isLoading ? (
        <LoadingPlaceholder />
      ) : isError ? (
        <p className="text-sm text-destructive">Couldn't load the audit log.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{filtered ? "No entries match those filters." : "No history yet."}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.id} className="rounded-lg border border-border bg-card px-4 py-3">
                <AuditFacts entry={row} when={formatDateTime(row.createdAt)} whenIso={row.createdAt} record={auditSubject(row.entityType, row.changes)} />
              </li>
            ))}
          </ul>
          {hasNextPage ? (
            <button
              type="button"
              className="w-fit rounded-md border border-border px-4 py-2 text-sm disabled:opacity-60"
              disabled={isFetchingNextPage}
              onClick={() => fetchNextPage()}
            >
              {isFetchingNextPage ? "Loading…" : "Show older entries"}
            </button>
          ) : (
            <p className="text-xs text-muted-foreground">That is the oldest entry you can see.</p>
          )}
        </>
      )}
    </div>
  );
}
