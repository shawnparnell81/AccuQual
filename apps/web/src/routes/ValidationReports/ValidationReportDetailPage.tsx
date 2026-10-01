import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useFormTemplates } from "../../api/formTemplatesQuery";
import { createResourceHooks } from "../../api/resourceHooks";
import { fileChosenFolder, FormNumberEditor, RecordFolderField, SaveResult, type SaveResultState } from "../../components/forms/FormDocumentControls";
import { RecordCrumbs } from "../../components/records/RecordStatus";
import { SaveStatus } from "../../components/shared/SaveStatus";
import { DeleteRecordButton } from "../../components/shared/DeleteRecordButton";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { useCurrentUser } from "../../hooks/useAuth";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { instanceRevision } from "../../lib/formDocument";
import { cellsFromBatch, isBatch3, overallBatch } from "../../lib/batch3Reports";
import { cellsFromData as springCellsFromData, overallResult as springOverall } from "../../lib/airSpringReport";
import { authorizedSignatureOf, cellsFromData as airCellsFromData, overallResult as airOverall } from "../../lib/airStrutReport";
import { cellsFromData as fuelCellsFromData, overallResult as fuelOverall } from "../../lib/fuelPumpReport";
import { blankBrakeCells, blankInjectorCells, cellsFromData as inspectionCells, furtherSignatureOf, overallBrake, overallInjector } from "../../lib/partInspection";
import { cellsFromData as csaCellsFromData, formTypeOf, overallResult as csaOverall, VALIDATION_FORMS, type CellValue, type ValidationFormType } from "../../lib/validationReport";
import { AirSpringSheet } from "./AirSpringSheet";
import { AirStrutSheet } from "./AirStrutSheet";
import { FuelPumpSheet } from "./FuelPumpSheet";
import { Batch3Sheet } from "./Batch3Sheet";
import { PartInspectionSheet } from "./PartInspectionSheet";
import { ValidationReportSheet } from "./ValidationReportSheet";
import { FormHeader } from "../../components/brand/DmaLogo";

interface ValidationReport {
  id: number;
  data: { formType?: ValidationFormType; cells?: Record<string, CellValue> };
  createdAt?: string | null;
  updatedAt?: string | null;
}

const hooks = createResourceHooks<ValidationReport>("validation-reports");

function loadCells(formType: ValidationFormType, data: unknown): Record<string, CellValue> {
  if (formType === "fuel_pump") return fuelCellsFromData(data);
  if (formType === "air_strut") return airCellsFromData(data);
  if (formType === "air_spring") return springCellsFromData(data);
  if (formType === "fuel_injector") return inspectionCells(data, blankInjectorCells);
  if (formType === "brake_wear") return inspectionCells(data, blankBrakeCells);
  if (isBatch3(formType)) return cellsFromBatch(formType, data);
  return csaCellsFromData(data);
}

function loadOverall(formType: ValidationFormType, cells: Record<string, CellValue>): string {
  if (formType === "fuel_pump") return fuelOverall(cells);
  if (formType === "air_strut") return airOverall(cells);
  if (formType === "air_spring") return springOverall(cells);
  if (formType === "fuel_injector") return overallInjector(cells);
  if (formType === "brake_wear") return overallBrake(cells);
  if (isBatch3(formType)) return overallBatch(formType, cells);
  return csaOverall(cells);
}

export function ValidationReportDetailPage() {
  const { id } = useParams();
  const reportId = Number(id);
  const user = useCurrentUser();
  const { effective } = useEffectivePermissions();
  const canEdit = user?.roleName === "admin" || user?.roleName === "owner" || effective?.documents === "edit";
  const queryClient = useQueryClient();
  const { data: report, isLoading, isError } = hooks.useOne(reportId);
  const updateReport = hooks.useUpdate();
  const signReport = hooks.useAction("sign");
  const [cells, setCells] = useState<Record<string, CellValue> | null>(null);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const [saveNote, setSaveNote] = useState<SaveResultState>(null);
  const [pending, setPending] = useState(false);

  const formType: ValidationFormType = formTypeOf(report?.data);
  const meta = VALIDATION_FORMS[formType];
  const formKey = meta.formKey;
  const templates = useFormTemplates();
  const documentNumber = templates.data?.find((item) => item.formKey === formKey)?.formId ?? "";

  useEffect(() => {
    if (!report || loadedFor === report.id) return;
    const next = loadCells(formTypeOf(report.data), report.data);
    setCells(next);
    setLoadedFor(report.id);
  }, [loadedFor, report]);

  if (isError) return <p className="text-sm text-destructive">Couldn't load this validation report. Refresh the page and try again.</p>;
  if (isLoading || !report || !cells) return <LoadingPlaceholder />;

  const filled = cells;
  const saved = loadCells(formType, report.data);
  const dirty = JSON.stringify(filled) !== JSON.stringify(saved);
  const result = loadOverall(formType, filled);
  const passed = result === "Pass" || result === "Passed" || result === "PASS";
  const failed = result === "Fail" || result === "Failed" || result === "FAIL";
  const badge = passed ? meta.pass : failed ? "#FF0000" : "transparent";
  const rev = instanceRevision(report.data, meta.revision);
  const doc = documentNumber.trim() ? `${documentNumber.trim()} Rev ${rev}` : `Rev ${rev}`;
  const title = `${meta.title} #${report.id}`;

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
            <RecordFolderField formKey={formKey} recordId={reportId} prepare={() => updateReport.mutateAsync({ id: reportId, data: { formType, cells: filled } })} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DeleteRecordButton
              resource="validation-reports"
              id={reportId}
              kind={meta.title}
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
        <FormHeader />
        {formType === "fuel_pump" ? (
          <FuelPumpSheet
            cells={cells}
            readOnly={!canEdit}
            documentNumber={documentNumber}
            revision={rev}
            onChange={(addr, value) => setCells((current) => (current ? { ...current, [addr]: value } : current))}
          />
        ) : formType === "air_strut" ? (
          <AirStrutSheet
            cells={cells}
            readOnly={!canEdit}
            documentNumber={documentNumber}
            revision={rev}
            signature={authorizedSignatureOf(report.data)}
            onSign={async (pin) => {
              await signReport.mutateAsync({ id: reportId, pin, certified: true });
            }}
            onChange={(addr, value) => setCells((current) => (current ? { ...current, [addr]: value } : current))}
          />
        ) : formType === "air_spring" ? (
          <AirSpringSheet
            cells={cells}
            readOnly={!canEdit}
            documentNumber={documentNumber}
            revision={rev}
            signature={authorizedSignatureOf(report.data)}
            onSign={async (pin) => {
              await signReport.mutateAsync({ id: reportId, pin, certified: true });
            }}
            onChange={(addr, value) => setCells((current) => (current ? { ...current, [addr]: value } : current))}
          />
        ) : formType === "fuel_injector" || formType === "brake_wear" ? (
          <PartInspectionSheet
            variant={formType}
            cells={cells}
            readOnly={!canEdit}
            documentNumber={documentNumber}
            revision={rev}
            signature={authorizedSignatureOf(report.data)}
            furtherSignature={furtherSignatureOf(report.data)}
            onSign={async (pin) => {
              await signReport.mutateAsync({ id: reportId, pin, certified: true });
            }}
            onFurtherSign={async (pin) => {
              await signReport.mutateAsync({ id: reportId, field: "furtherSignature", pin, certified: true });
            }}
            onChange={(addr, value) => setCells((current) => (current ? { ...current, [addr]: value } : current))}
          />
        ) : isBatch3(formType) ? (
          <Batch3Sheet
            variant={formType}
            cells={cells}
            readOnly={!canEdit}
            documentNumber={documentNumber}
            revision={rev}
            signature={authorizedSignatureOf(report.data)}
            furtherSignature={furtherSignatureOf(report.data)}
            onSign={
              formType === "shock"
                ? undefined
                : async (pin) => {
                    await signReport.mutateAsync({ id: reportId, pin, certified: true });
                  }
            }
            onFurtherSign={
              formType === "gas_lift"
                ? async (pin) => {
                    await signReport.mutateAsync({ id: reportId, field: "furtherSignature", pin, certified: true });
                  }
                : undefined
            }
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
