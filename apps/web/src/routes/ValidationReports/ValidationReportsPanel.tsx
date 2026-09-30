import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { FormNumberEditor } from "../../components/forms/FormDocumentControls";
import { createResourceHooks } from "../../api/resourceHooks";
import { formatDate } from "../../lib/dates";
import { cellsFromData as fuelCellsFromData, overallResult as fuelOverall } from "../../lib/fuelPumpReport";
import { cellsFromData, formTypeOf, overallResult, type CellValue, type ValidationFormType } from "../../lib/validationReport";
import { useCurrentUser } from "../../hooks/useAuth";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";

interface ValidationReport {
  id: number;
  data: { formType?: ValidationFormType; cells?: Record<string, CellValue> };
  createdAt?: string | null;
  updatedAt?: string | null;
}

const hooks = createResourceHooks<ValidationReport>("validation-reports");

const FORM_KEYS: Record<ValidationFormType, string> = { csa: "frm-val-001", fuel_pump: "frm-val-007" };

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
          <h2 className="text-lg font-semibold">CSA Validation and Fuel Pump Validation</h2>
          <p className="text-sm text-muted-foreground">
            Start a CSA Validation or a Fuel Pump Validation, choose a Documents folder, and save. Open folder on the save line takes you there. You can also browse Quality, Document Control, Folder Explorer.
          </p>
          <div className="mt-2 flex flex-wrap gap-4">
            <FormNumberEditor formKey="frm-val-001" compact />
            <FormNumberEditor formKey="frm-val-007" compact />
          </div>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => start("csa")}
              disabled={createReport.isPending}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {pendingKind === "csa" ? "Creating…" : "New CSA Validation"}
            </button>
            <button
              type="button"
              onClick={() => start("fuel_pump")}
              disabled={createReport.isPending}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
            >
              {pendingKind === "fuel_pump" ? "Creating…" : "New Fuel Pump Validation"}
            </button>
          </div>
        )}
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Loading records…</p>}
      {isError && <p className="text-sm text-destructive">Couldn't load validation reports.</p>}
      {!isLoading && !isError && rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No validation reports yet. Use New CSA Validation or New Fuel Pump Validation to start one.
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
                const cells = kind === "fuel_pump" ? fuelCellsFromData(row.data) : cellsFromData(row.data);
                const result = kind === "fuel_pump" ? fuelOverall(cells) : overallResult(cells);
                const passed = result === "Pass" || result === "Passed";
                const failed = result === "Fail" || result === "Failed";
                const color = passed ? (kind === "fuel_pump" ? "#00B050" : "#4EA72E") : failed ? "#FF0000" : "transparent";
                const number = filing.data?.templates.find((item) => item.formKey === FORM_KEYS[kind])?.formId?.trim() ?? "";
                const name = number ? `${number} #${row.id}` : kind === "fuel_pump" ? `Fuel Pump Validation #${row.id}` : `CSA Validation #${row.id}`;
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
