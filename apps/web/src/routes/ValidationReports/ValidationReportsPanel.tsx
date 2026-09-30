import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { FormNumberEditor } from "../../components/forms/FormDocumentControls";
import { createResourceHooks } from "../../api/resourceHooks";
import { formatDate } from "../../lib/dates";
import { cellsFromBatch, isBatch3, overallBatch } from "../../lib/batch3Reports";
import { cellsFromData as springCellsFromData, overallResult as springOverall } from "../../lib/airSpringReport";
import { cellsFromData as airCellsFromData, overallResult as airOverall } from "../../lib/airStrutReport";
import { cellsFromData as fuelCellsFromData, overallResult as fuelOverall } from "../../lib/fuelPumpReport";
import { blankBrakeCells, blankInjectorCells, cellsFromData as inspectionCells, overallBrake, overallInjector } from "../../lib/partInspection";
import { cellsFromData, formTypeOf, overallResult, VALIDATION_FORMS, type CellValue, type ValidationFormType } from "../../lib/validationReport";
import { useCurrentUser } from "../../hooks/useAuth";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";

interface ValidationReport {
  id: number;
  data: { formType?: ValidationFormType; cells?: Record<string, CellValue> };
  createdAt?: string | null;
  updatedAt?: string | null;
}

const hooks = createResourceHooks<ValidationReport>("validation-reports");

function rowCells(kind: ValidationFormType, data: unknown): Record<string, CellValue> {
  if (kind === "fuel_pump") return fuelCellsFromData(data);
  if (kind === "air_strut") return airCellsFromData(data);
  if (kind === "air_spring") return springCellsFromData(data);
  if (kind === "fuel_injector") return inspectionCells(data, blankInjectorCells);
  if (kind === "brake_wear") return inspectionCells(data, blankBrakeCells);
  if (isBatch3(kind)) return cellsFromBatch(kind, data);
  return cellsFromData(data);
}

function rowResult(kind: ValidationFormType, cells: Record<string, CellValue>): string {
  if (kind === "fuel_pump") return fuelOverall(cells);
  if (kind === "air_strut") return airOverall(cells);
  if (kind === "air_spring") return springOverall(cells);
  if (kind === "fuel_injector") return overallInjector(cells);
  if (kind === "brake_wear") return overallBrake(cells);
  if (isBatch3(kind)) return overallBatch(kind, cells);
  return overallResult(cells);
}

export function ValidationReportsPanel() {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const { effective } = useEffectivePermissions();
  const canEdit = user?.roleName === "admin" || user?.roleName === "owner" || effective?.documents === "edit";
  const { data: rows = [], isLoading, isError } = hooks.useList();
  const filing = useQuery({
    queryKey: ["form-templates"],
    queryFn: async () => (await apiClient.get<{ templates: { formKey: string; formId: string }[] }>("/document-folders/form-templates")).data,
  });
  const createReport = hooks.useCreate();
  const [pendingKind, setPendingKind] = useState<ValidationFormType | null>(null);

  function start(formType: ValidationFormType) {
    setPendingKind(formType);
    createReport.mutate({ data: { formType, cells: {} } } as never, {
      onSuccess: (created) => navigate(`/validation-reports/${created.id}`),
      onSettled: () => setPendingKind(null),
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Validation Reports</h2>
          <p className="text-sm text-muted-foreground">
            Start a validation, choose a Documents folder, and save. Open folder on the save line takes you there. You can also browse Quality, Document Control, Folder Explorer.
          </p>
          <div className="mt-2 flex flex-wrap gap-4">
            {(Object.keys(VALIDATION_FORMS) as ValidationFormType[]).map((kind) => (
              <FormNumberEditor key={kind} formKey={VALIDATION_FORMS[kind].formKey} compact />
            ))}
          </div>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {(Object.keys(VALIDATION_FORMS) as ValidationFormType[]).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => start(kind)}
                disabled={createReport.isPending}
                className={`rounded-md px-3 py-2 text-sm font-medium disabled:opacity-60 ${kind === "csa" ? "bg-primary text-primary-foreground" : "border border-border bg-card hover:bg-muted"}`}
              >
                {pendingKind === kind ? "Creating…" : `New ${VALIDATION_FORMS[kind].title}`}
              </button>
            ))}
          </div>
        )}
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Loading records…</p>}
      {isError && <p className="text-sm text-destructive">Couldn't load validation reports.</p>}
      {!isLoading && !isError && rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No validation reports yet. Use a New button to start one.
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
                const kind = formTypeOf(row.data);
                const cells = rowCells(kind, row.data);
                const result = rowResult(kind, cells);
                const passed = result === "Pass" || result === "Passed" || result === "PASS";
                const failed = result === "Fail" || result === "Failed" || result === "FAIL";
                const color = passed ? VALIDATION_FORMS[kind].pass : failed ? "#FF0000" : "transparent";
                const number = filing.data?.templates.find((item) => item.formKey === VALIDATION_FORMS[kind].formKey)?.formId?.trim() ?? "";
                const name = number ? `${number} #${row.id}` : `${VALIDATION_FORMS[kind].title} #${row.id}`;
                return (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">
                      <button type="button" onClick={() => navigate(`/validation-reports/${row.id}`)} className="text-left text-primary hover:underline">
                        {name}
                      </button>
                    </td>
                    <td className="px-3 py-2">{cells.B6 || "—"}</td>
                    <td className="px-3 py-2">
                      <span className="rounded px-1.5 py-0.5 text-xs font-semibold" style={{ background: color, color: "#111" }}>
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
