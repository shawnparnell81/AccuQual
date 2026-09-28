import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { formatDate } from "../../lib/dates";
import { cellsFromData, overallResult, type CellValue } from "../../lib/validationReport";
import { useCurrentUser } from "../../hooks/useAuth";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";

interface ValidationReport {
  id: number;
  data: { cells?: Record<string, CellValue> };
  createdAt?: string | null;
  updatedAt?: string | null;
}

const hooks = createResourceHooks<ValidationReport>("validation-reports");

export function ValidationReportsPanel() {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const { effective } = useEffectivePermissions();
  const canEdit = user?.roleName === "admin" || user?.roleName === "owner" || effective?.documents === "edit";
  const { data: rows = [], isLoading, isError } = hooks.useList();
  const createReport = hooks.useCreate();

  function start() {
    createReport.mutate({ data: { cells: {} } } as never, {
      onSuccess: (created) => navigate(`/validation-reports/${created.id}`),
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Validation Report records</h2>
          <p className="text-sm text-muted-foreground">Fill in FRM-VAL-001, save it, and open it again from this folder.</p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={start}
            disabled={createReport.isPending}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {createReport.isPending ? "Creating…" : "New Validation Report"}
          </button>
        )}
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Loading records…</p>}
      {isError && <p className="text-sm text-destructive">Couldn't load validation reports.</p>}
      {!isLoading && !isError && rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No validation reports yet. Use New Validation Report to start one.
        </div>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Report</th>
                <th className="px-3 py-2 font-medium">Part number</th>
                <th className="px-3 py-2 font-medium">Result</th>
                <th className="px-3 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const cells = cellsFromData(row.data);
                const result = overallResult(cells);
                return (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">
                      <button type="button" onClick={() => navigate(`/validation-reports/${row.id}`)} className="text-left text-primary hover:underline">
                        Validation Report #{row.id}
                      </button>
                    </td>
                    <td className="px-3 py-2">{cells.B6 || "—"}</td>
                    <td className="px-3 py-2">
                      <span className="rounded px-1.5 py-0.5 text-xs font-semibold" style={{ background: result === "Failed" ? "#FF0000" : "#4EA72E", color: "#111" }}>
                        {result}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{row.updatedAt || row.createdAt ? formatDate(row.updatedAt ?? row.createdAt) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
