import type { FormLayout } from "../forms/layouts/types.js";
import { renderFormLayoutAsPdf } from "../forms/schema-pdf-renderer.js";
import { emptyFrame, type ApprovalLine } from "../forms/controlledPdf.js";
import { applyChrome, type PdfChrome } from "../pdf-exports/pdfExportStore.js";
import { vehicleApplication, type CsaState } from "./csaFai.logic.js";

/** Final CSA first-article report. Generated at release and kept in the archive. */
export async function renderCsaPdf(state: CsaState, chrome?: PdfChrome | null): Promise<Uint8Array> {
  const attempts = [...state.history, state.attempt];
  const data: Record<string, unknown> = {
    number: state.number,
    status: state.status,
    partNumber: state.partNumber,
    partDescription: state.partDescription,
    supplierName: state.supplierName,
    supplierPartNumber: state.supplierPartNumber,
    sampleLotNumber: state.sampleLotNumber,
    vehicle: vehicleApplication(state),
    inspectorName: state.inspectorName,
    dateOpened: state.dateOpened.slice(0, 10),
    stage: state.stage,
    productionRelease: state.productionRelease,
    ncrNumber: "",
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
            { kind: "text", name: "supplierName", label: "Supplier" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "supplierPartNumber", label: "Supplier part" },
            { kind: "text", name: "sampleLotNumber", label: "Sample lot" },
            { kind: "text", name: "vehicle", label: "Vehicle" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "inspectorName", label: "Inspector" },
            { kind: "text", name: "dateOpened", label: "Opened" },
            { kind: "text", name: "productionRelease", label: "Production release" },
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
  if (state.signatureStamp) {
    approvals.push({ name: state.signatureStamp, role: "", action: "Signed", at: state.approvalDate ?? "", status: state.status });
  }
  const built = emptyFrame({
    sourceModule: "CSA First Article",
    recordNumber: state.number,
    revision: "",
    generatedBy: state.inspectorName || "AccuQual",
    status: state.status,
    approvals,
  });
  const frame = chrome ? applyChrome(built, chrome) : built;
  const layout: FormLayout = { formType: "csa_fai", title: "Complete Strut Assembly — First Article Inspection", sections };
  return renderFormLayoutAsPdf(layout, data, frame);
}
