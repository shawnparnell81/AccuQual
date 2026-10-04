import type { FormLayout } from "../forms/layouts/types.js";
import { renderFormLayoutAsPdf } from "../forms/schema-pdf-renderer.js";
import { emptyFrame } from "../forms/controlledPdf.js";
import { applyChrome, type PdfChrome } from "../pdf-exports/pdfExportStore.js";
import { limitsLabel, type CharacteristicMode } from "./fai.logic.js";

export interface FaiPdfLine {
  balloon: string | null;
  name: string;
  mode: CharacteristicMode;
  nominal: string | null;
  percent: string | null;
  plusTolerance: string | null;
  minusTolerance: string | null;
  limitLow: string | null;
  limitHigh: string | null;
  actual: string | null;
  attributeResult: string | null;
  result: string | null;
}

export interface FaiPdfModel {
  number: string;
  partNumber: string;
  partName: string | null;
  supplierName: string;
  planName: string;
  planRevision: number;
  outcome: string;
  comments: string | null;
  qualitySignature: string | null;
  decidedOn: string | null;
  ncrNumber: string | null;
  lines: FaiPdfLine[];
}

/** One PDF for a finished first article: characteristics, limits, actuals, signer, and outcome. */
export async function renderFaiPdf(model: FaiPdfModel, chrome?: PdfChrome | null): Promise<Uint8Array> {
  const sections: FormLayout["sections"] = [
    {
      number: "1",
      title: "Record",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "number", label: "Record number" },
            { kind: "text", name: "outcome", label: "Status" },
            { kind: "text", name: "revision", label: "Revision" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "partNumber", label: "Part" },
            { kind: "text", name: "partName", label: "Part name" },
            { kind: "text", name: "supplierName", label: "Supplier" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "planName", label: "Plan" },
            { kind: "text", name: "ncrNumber", label: "NCR" },
          ],
        },
      ],
    },
    {
      number: "2",
      title: "Characteristics",
      blocks: [
        {
          type: "table",
          name: "lines",
          columns: [
            { key: "balloon", label: "Balloon", kind: "text" },
            { key: "name", label: "Characteristic", kind: "text" },
            { key: "spec", label: "Spec", kind: "text" },
            { key: "nominal", label: "Nominal", kind: "text" },
            { key: "limits", label: "Limits", kind: "text" },
            { key: "actual", label: "Actual", kind: "text" },
            { key: "result", label: "Pass/Fail", kind: "text" },
            { key: "comments", label: "Comments", kind: "text" },
          ],
        },
      ],
    },
  ];
  if (model.comments) {
    sections.push({ number: "3", title: "Notes", blocks: [{ type: "textarea", name: "comments", label: "Comments" }] });
  }
  if (model.qualitySignature) {
    sections.push({
      number: "4",
      title: "Approval",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "qualitySignature", label: "Signature" },
            { kind: "text", name: "decidedOn", label: "Date" },
            { kind: "text", name: "outcome", label: "Outcome" },
          ],
        },
      ],
    });
  }
  const layout: FormLayout = { formType: "fai", title: "First Article Inspection", sections };
  const built = emptyFrame({
    sourceModule: "FAI",
    recordNumber: model.number,
    revision: String(model.planRevision),
    generatedBy: "AccuQual",
    status: model.outcome,
    approvals: model.qualitySignature
      ? [{ name: model.qualitySignature, role: "", action: "Signed", at: model.decidedOn ?? "", status: /^approv/i.test(model.outcome) ? "Approved" : model.outcome }]
      : [],
  });
  const frame = chrome ? applyChrome(built, chrome) : built;
  return renderFormLayoutAsPdf(
    layout,
    {
      number: model.number,
      outcome: model.outcome,
      revision: String(model.planRevision),
      partNumber: model.partNumber,
      partName: model.partName ?? "",
      supplierName: model.supplierName,
      planName: model.planName,
      ncrNumber: model.ncrNumber ?? "",
      comments: model.comments ?? "",
      qualitySignature: model.qualitySignature ?? "",
      decidedOn: model.decidedOn ?? "",
      lines: model.lines.map((line) => ({
        balloon: line.balloon ?? "",
        name: line.name,
        spec: line.mode,
        nominal: line.nominal ?? "",
        limits: limitsLabel(line),
        actual: line.actual ?? line.attributeResult ?? "",
        result: line.result ?? "",
        comments: "",
      })),
    },
    frame,
  );
}
