import type { FormLayout } from "../forms/layouts/types.js";
import { renderFormLayoutAsPdf } from "../forms/schema-pdf-renderer.js";
import { emptyFrame, type ApprovalLine } from "../forms/controlledPdf.js";
import { applyChrome, type PdfChrome } from "../pdf-exports/pdfExportStore.js";
import { vehicleApplication, type FpmState } from "./fuelPumpFai.logic.js";

/** Final fuel-pump first-article report. Generated at release and kept in the archive. */
export async function renderFuelPumpPdf(state: FpmState, chrome?: PdfChrome | null): Promise<Uint8Array> {
  const attempts = [...state.history, state.attempt];
  const data: Record<string, unknown> = {
    number: state.number,
    status: state.status,
    partNumber: state.partNumber,
    partDescription: state.partDescription,
    supplier: state.supplier,
    supplierPartNumber: state.supplierPartNumber,
    sampleLotNumber: state.sampleLotNumber,
    vehicle: vehicleApplication(state),
    inspector: state.inspector,
    dateOpened: state.dateOpened.slice(0, 10),
    stage: state.stage,
    productionRelease: state.productionRelease,
    ncrNumber: "",
    flowRateResult: state.flowRateResult ?? "",
    pressureResult: state.pressureResult ?? "",
    currentDrawResult: state.currentDrawResult ?? "",
    electricalResult: state.electricalResult ?? "",
    fitmentResult: state.fitmentResult ?? "",
    packagingResult: state.packagingResult ?? "",
  };
  const sections: FormLayout["sections"] = [
    {
      number: "1",
      title: "Record",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "number", label: "Record number" },
            { kind: "text", name: "status", label: "Status" },
            { kind: "text", name: "stage", label: "Stage" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "partNumber", label: "Part" },
            { kind: "text", name: "partDescription", label: "Description" },
            { kind: "text", name: "supplier", label: "Supplier" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "sampleLotNumber", label: "Sample lot" },
            { kind: "text", name: "vehicle", label: "Vehicle" },
            { kind: "text", name: "inspector", label: "Inspector" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "flowRateResult", label: "Flow" },
            { kind: "text", name: "pressureResult", label: "Pressure" },
            { kind: "text", name: "currentDrawResult", label: "Current draw" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "electricalResult", label: "Electrical" },
            { kind: "text", name: "fitmentResult", label: "Fitment" },
            { kind: "text", name: "packagingResult", label: "Packaging" },
            { kind: "text", name: "ncrNumber", label: "NCR" },
          ],
        },
      ],
    },
  ];
  attempts.forEach((attempt, index) => {
    const name = `attempt_${index}`;
    data[name] = attempt.results.map((row) => ({
      name: row.label,
      spec: row.specifiedLimits ?? "",
      nominal: "",
      limits: row.specifiedLimits ?? "",
      units: row.units ?? "",
      actual: row.actual ?? "",
      result: row.result ?? "",
      comments: row.comments ?? "",
    }));
    sections.push({
      number: String(index + 2),
      title: `Attempt ${attempt.number}`,
      blocks: [
        {
          type: "table",
          name,
          columns: [
            { key: "name", label: "Characteristic", kind: "text" },
            { key: "spec", label: "Spec", kind: "text" },
            { key: "nominal", label: "Nominal", kind: "text" },
            { key: "limits", label: "Limits", kind: "text" },
            { key: "units", label: "Units", kind: "text" },
            { key: "actual", label: "Actual", kind: "text" },
            { key: "result", label: "Pass/Fail", kind: "text" },
            { key: "comments", label: "Comments", kind: "text" },
          ],
        },
      ],
    });
  });
  const approvals: ApprovalLine[] = [];
  if (state.signatureStamp) approvals.push({ name: state.signatureStamp, role: "", action: "Signed", at: state.approvalDate ?? "", status: state.status });
  const built = emptyFrame({
    sourceModule: "Fuel Pump First Article",
    recordNumber: state.number,
    revision: "",
    generatedBy: state.inspector || "AccuQual",
    status: state.status,
    approvals,
  });
  const frame = chrome ? applyChrome(built, chrome) : built;
  const layout: FormLayout = { formType: "fuel_pump_fai", title: "Fuel Pump Module — First Article Inspection", sections };
  return renderFormLayoutAsPdf(layout, data, frame);
}
