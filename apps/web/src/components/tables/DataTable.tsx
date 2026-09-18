import type { ReactNode } from "react";

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
}

/** Generic list table shared by every module's list page (NCR, CAPA, Audits, ...). */
export function DataTable<T>({ columns, rows, rowKey, onRowClick, isLoading, isError, errorMessage = "Couldn't load this data — try refreshing the page.", emptyMessage = "No records" }: DataTableProps<T>) {
  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (isError) {
    return <div className="p-6 text-sm text-destructive">{errorMessage}</div>;
  }

  if (rows.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">{emptyMessage}</div>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            {columns.map((col) => (
              <th key={col.header} className="px-4 py-2 text-left font-medium">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={() => onRowClick?.(row)}
              className={onRowClick ? "cursor-pointer border-t border-border hover:bg-muted/50" : "border-t border-border"}
            >
              {columns.map((col) => (
                <td key={col.header} className={`px-4 py-2 ${col.className ?? ""}`}>
                  {col.accessor(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
