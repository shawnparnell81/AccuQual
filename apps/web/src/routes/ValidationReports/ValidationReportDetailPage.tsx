import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { createResourceHooks } from "../../api/resourceHooks";
import { fileChosenFolder, FormNumberEditor, RecordFolderField, SaveResult, type SaveResultState } from "../../components/forms/FormDocumentControls";
import { RecordCrumbs } from "../../components/records/RecordStatus";
import { SaveStatus } from "../../components/shared/SaveStatus";
import { DeleteRecordButton } from "../../components/shared/DeleteRecordButton";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { useCurrentUser } from "../../hooks/useAuth";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { instanceRevision } from "../../lib/formDocument";
import { cellsFromData as csaCellsFromData, formTypeOf, overallResult as csaOverall, type CellValue, type ValidationFormType } from "../../lib/validationReport";
import { cellsFromData as fuelCellsFromData, overallResult as fuelOverall } from "../../lib/fuelPumpReport";
import { FuelPumpSheet } from "./FuelPumpSheet";
import { ValidationReportSheet } from "./ValidationReportSheet";

interface ValidationReport {
  id: number;
  data: { formType?: ValidationFormType; cells?: Record<string, CellValue> };
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
  const queryClient = useQueryClient();
  const { data: report, isLoading, isError } = hooks.useOne(reportId);
  const updateReport = hooks.useUpdate();
  const [cells, setCells] = useState<Record<string, CellValue> | null>(null);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const [saveNote, setSaveNote] = useState<SaveResultState>(null);
  const [pending, setPending] = useState(false);

  const formType: ValidationFormType = formTypeOf(report?.data);
  const formKey = formType === "fuel_pump" ? "frm-val-007" : "frm-val-001";
  const templates = useQuery({
    queryKey: ["form-templates"],
    queryFn: async () => (await apiClient.get<{ templates: { formKey: string; formId: string }[] }>("/document-folders/form-templates")).data.templates,
  });
  const documentNumber = templates.data?.find((item) => item.formKey === formKey)?.formId ?? "";

  useEffect(() => {
    if (!report || loadedFor === report.id) return;
    const next = formTypeOf(report.data) === "fuel_pump" ? fuelCellsFromData(report.data) : csaCellsFromData(report.data);
    setCells(next);
    setLoadedFor(report.id);
  }, [loadedFor, report]);

  if (isError) return <p className="text-sm text-destructive">Couldn't load this validation report. Refresh the page and try again.</p>;
  if (isLoading || !report || !cells) return <LoadingPlaceholder />;

  const filled = cells;
  const saved = formType === "fuel_pump" ? fuelCellsFromData(report.data) : csaCellsFromData(report.data);
  const dirty = JSON.stringify(filled) !== JSON.stringify(saved);
  const result = formType === "fuel_pump" ? fuelOverall(filled) : csaOverall(filled);
  const passed = result === "Pass" || result === "Passed";
  const failed = result === "Fail" || result === "Failed";
  const badge = passed ? (formType === "fuel_pump" ? "#00B050" : "#4EA72E") : failed ? "#FF0000" : "transparent";
  const rev = instanceRevision(report.data, "C");
  const doc = documentNumber.trim() ? `${documentNumber.trim()} Rev ${rev}` : `Rev ${rev}`;
  const title = formType === "fuel_pump" ? `Fuel Pump Validation #${report.id}` : `CSA Validation #${report.id}`;

  async function saveRecord() {
    setPending(true);
    setSaveNote(null);
    try {
      await updateReport.mutateAsync({ id: reportId, data: { formType, cells: filled } });
    } catch {
      setSaveNote("error");
      setPending(false);
      return;
    }
    try {
      const filed = await fileChosenFolder(queryClient, formKey, reportId);
      setSaveNote(filed ?? "unfiled");
    } catch {
      setSaveNote("file-error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="validation-report-print flex min-w-0 flex-col gap-4">
      <div className="no-print flex flex-col gap-4">
        <RecordCrumbs
          items={[
            { label: "Validation Reports", to: "/folders/validation-reports" },
            { label: title },
          ]}
        />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{title}</h1>
            <FormNumberEditor formKey={formKey} compact />
            <p className="text-sm text-muted-foreground">
              {doc}
              {cells.B6 ? ` · ${cells.B6}` : ""}
              {" · "}
              <Link to="/folders/validation-reports" className="text-primary hover:underline">
                Validation Reports
              </Link>
            </p>
            <RecordFolderField formKey={formKey} recordId={reportId} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DeleteRecordButton
              resource="validation-reports"
              id={reportId}
              kind={formType === "fuel_pump" ? "Fuel Pump Validation" : "CSA Validation"}
              title={cells.B6 == null ? null : String(cells.B6)}
              navigateTo="/folders/validation-reports"
            />
            <span className="rounded-md px-2 py-1 text-sm font-semibold" style={{ background: badge, color: "#111" }} data-testid="validation-overall">
              {result}
            </span>
            <SaveStatus saving={updateReport.isPending || pending} unsaved={dirty && !updateReport.isPending && !pending} />
            {canEdit && (
              <button
                type="button"
                onClick={() => void saveRecord()}
                disabled={updateReport.isPending || pending}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
              >
                {updateReport.isPending || pending ? "Saving…" : "Save"}
              </button>
            )}
            <SaveResult result={saveNote} />
            <button type="button" onClick={() => window.print()} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              Print
            </button>
          </div>
        </div>
      </div>

      <div className="aq-print-sheet min-w-0 rounded-lg border border-border bg-card p-4">
        {formType === "fuel_pump" ? (
          <FuelPumpSheet
            cells={cells}
            readOnly={!canEdit}
            documentNumber={documentNumber}
            revision={rev}
            onChange={(addr, value) => setCells((current) => (current ? { ...current, [addr]: value } : current))}
          />
        ) : (
          <ValidationReportSheet
            cells={cells}
            readOnly={!canEdit}
            documentNumber={documentNumber}
            revision={rev}
            onChange={(addr, value) => setCells((current) => (current ? { ...current, [addr]: value } : current))}
          />
        )}
      </div>
    </div>
  );
}
