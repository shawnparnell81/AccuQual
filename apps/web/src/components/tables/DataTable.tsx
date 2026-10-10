import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { FilterBar, SummaryCards, summarizeRecords } from "../layout/PageHeader";

export interface Column<T> {
  header: string;
  accessor: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  isLoading?: boolean;
  /**
   * Full-System Audit finding C6: this component (and the useOne/useList
   * hooks feeding it) never distinguished "the request failed" from
   * "genuinely zero records" — both rendered emptyMessage, and a query
   * stuck retrying after a failure rendered "Loading…" forever. A Quality
   * Manager had no way to tell "no open NCRs" from "the backend just
   * failed." Pass a query's own isError through here to get a real,
   * visually distinct error state instead.
   */
  isError?: boolean;
  errorMessage?: string;
  emptyMessage?: string;
  /**
   * Bulk actions (see crudFactory.ts's bulkUpdate) — both optional and
   * undefined by default, so every one of this component's ~21 existing
   * callers renders exactly as before with no checkbox column at all.
   * DataTable owns the add/remove/select-all-visible toggle logic (it
   * already has `rows` and `rowKey`); the caller only holds the resulting
   * `Set` and decides what a non-empty selection means for its own page
   * (e.g. showing a bulk-action toolbar).
   */
  selectedIds?: Set<string | number>;
  onSelectionChange?: (ids: Set<string | number>) => void;
  /**
   * A count row and a text filter above the table. Turn this off when the
   * page already draws its own summary and filters.
   */
  listChrome?: boolean;
}

/** Generic list table shared by every module's list page (NCR, CAPA, Audits, ...). */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  isLoading,
  isError,
  errorMessage = "Couldn't load this data — try refreshing the page.",
  emptyMessage = "No records",
  selectedIds,
  onSelectionChange,
  listChrome = true,
}: DataTableProps<T>) {
  const selectable = selectedIds !== undefined && onSelectionChange !== undefined;
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!listChrome || !needle) return rows;
    return rows.filter((row) => recordText(row).includes(needle));
  }, [filter, listChrome, rows]);
  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-card" aria-busy="true" aria-label="Loading">
        <div className="skeleton h-9 rounded-none" />
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-t border-border/70 px-4 py-3">
            <div className="skeleton h-3.5 w-10" />
            <div className="skeleton h-3.5 flex-1" style={{ maxWidth: `${55 + ((i * 13) % 35)}%` }} />
            <div className="skeleton h-3.5 w-20" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-5 text-sm text-destructive">
        <AlertTriangle size={18} className="shrink-0" />
        {errorMessage}
      </div>
    );
  }

  const chrome = listChrome ? (
    <div className="flex flex-col gap-6">
      <SummaryCards items={summarizeRecords(shown)} />
      <FilterBar>
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter this list…"
          aria-label="Filter this list"
          className="w-64 border border-border bg-background px-3 py-1.5 text-sm"
        />
        <span className="text-sm text-muted-foreground">
          {shown.length} of {rows.length}
        </span>
      </FilterBar>
    </div>
  ) : null;

  if (rows.length === 0 || shown.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        {chrome}
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Inbox size={22} />
          </span>
          <p className="max-w-md text-sm text-muted-foreground">{filter.trim() ? "Nothing matches this filter." : emptyMessage}</p>
        </div>
      </div>
    );
  }

  const visibleIds = shown.map(rowKey);
  const allVisibleSelected = selectable && visibleIds.length > 0 && visibleIds.every((id) => selectedIds!.has(id));

  function toggleOne(id: string | number) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange!(next);
  }

  function toggleAllVisible() {
    const next = new Set(selectedIds);
    if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
    else visibleIds.forEach((id) => next.add(id));
    onSelectionChange!(next);
  }

  return (
    <div className="flex flex-col gap-6">
      {chrome}
      <div className="aq-list-table">
        <table>
          <thead>
            <tr>
              {selectable && (
                <th className="w-8">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Select all" />
                </th>
              )}
              {columns.map((col) => (
                <th key={col.header} className="text-left">
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, rowIndex) => {
              const id = rowKey(row);
              return (
                <tr
                  key={id}
                  onClick={() => onRowClick?.(row)}
                  style={{ animationDelay: `${Math.min(rowIndex, 14) * 22}ms` }}
                  className={`row-in ${onRowClick ? "cursor-pointer hover:bg-primary/5" : ""}`}
                >
                  {selectable && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selectedIds!.has(id)} onChange={() => toggleOne(id)} aria-label="Select row" />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.header} className={col.className ?? ""}>
                      {col.accessor(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function recordText(row: unknown): string {
  if (!row || typeof row !== "object") return "";
  return Object.entries(row as Record<string, unknown>)
    .filter(([key, value]) => !/password|secret|token|hash/i.test(key) && (typeof value === "string" || typeof value === "number"))
    .map(([, value]) => String(value))
    .join(" ")
    .toLowerCase();
}
