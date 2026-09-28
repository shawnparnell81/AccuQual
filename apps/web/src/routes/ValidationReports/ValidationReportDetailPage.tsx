import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { RecordCrumbs } from "../../components/records/RecordStatus";
import { SaveStatus } from "../../components/shared/SaveStatus";
import { DeleteRecordButton } from "../../components/shared/DeleteRecordButton";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { useCurrentUser } from "../../hooks/useAuth";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { cellsFromData, overallResult, type CellValue } from "../../lib/validationReport";
import { ValidationReportSheet } from "./ValidationReportSheet";

interface ValidationReport {
  id: number;
  data: { cells?: Record<string, CellValue> };
  createdAt?: string | null;
  updatedAt?: string | null;
}

const hooks = createResourceHooks<ValidationReport>("validation-reports");

export function ValidationReportDetailPage() {
  const { id } = useParams();
  const reportId = Number(id);
  const user = useCurrentUser();
  const { effective } = useEffectivePermissions();
  const canEdit = user?.roleName === "admin" || user?.roleName === "owner" || effective?.documents === "edit";
  const { data: report, isLoading, isError } = hooks.useOne(reportId);
  const updateReport = hooks.useUpdate();
  const [cells, setCells] = useState<Record<string, CellValue> | null>(null);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);

  useEffect(() => {
    if (!report || loadedFor === report.id) return;
    setCells(cellsFromData(report.data));
    setLoadedFor(report.id);
  }, [loadedFor, report]);

  if (isError) return <p className="text-sm text-destructive">Couldn't load this validation report. Refresh the page and try again.</p>;
  if (isLoading || !report || !cells) return <LoadingPlaceholder />;

  const filled = cells;
  const saved = cellsFromData(report.data);
  const dirty = JSON.stringify(filled) !== JSON.stringify(saved);
  const result = overallResult(filled);

  function saveRecord() {
    updateReport.mutate({ id: reportId, data: { cells: filled } });
  }

  return (
    <div className="validation-report-print flex flex-col gap-4">
      <div className="no-print flex flex-col gap-4">
        <RecordCrumbs
          items={[
            { label: "Validation Reports", to: "/folders/validation-reports" },
            { label: `Validation Report #${report.id}` },
          ]}
        />
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Validation Report #{report.id}</h1>
            <p className="text-sm text-muted-foreground">
              FRM-VAL-001 Rev C
              {cells.B6 ? ` · ${cells.B6}` : ""}
              {" · "}
              <Link to="/folders/validation-reports" className="text-primary hover:underline">
                Validation Reports
              </Link>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <DeleteRecordButton resource="validation-reports" id={reportId} kind="Validation Report" title={cells.B6 == null ? null : String(cells.B6)} navigateTo="/folders/validation-reports" />
            <span
              className="rounded-md px-2 py-1 text-sm font-semibold"
              style={{ background: result === "Failed" ? "#FF0000" : "#4EA72E", color: "#111" }}
              data-testid="validation-overall"
            >
              {result}
            </span>
            <SaveStatus saving={updateReport.isPending} unsaved={dirty && !updateReport.isPending} />
            {canEdit && (
              <button
                type="button"
                onClick={saveRecord}
                disabled={updateReport.isPending}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
              >
                {updateReport.isPending ? "Saving…" : "Save"}
              </button>
            )}
            <button type="button" onClick={() => window.print()} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              Print
            </button>
          </div>
        </div>
      </div>

      <div className="aq-print-sheet rounded-lg border border-border bg-card p-4">
        <ValidationReportSheet
          cells={cells}
          readOnly={!canEdit}
          onChange={(addr, value) => setCells((current) => (current ? { ...current, [addr]: value } : current))}
        />
      </div>
    </div>
  );
}
