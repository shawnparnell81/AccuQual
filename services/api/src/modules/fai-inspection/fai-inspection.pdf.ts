import type { FormLayout } from "../forms/layouts/types.js";
import { renderFormLayoutAsPdf } from "../forms/schema-pdf-renderer.js";
import { emptyFrame } from "../forms/controlledPdf.js";
import { applyChrome, loadPdfChrome } from "../pdf-exports/pdfExportStore.js";
import { getRecord } from "./fai-inspection.service.js";

export interface FaiInspectionPdfLine {
  name: string;
  charType: string;
  spec: string;
  measured: string;
  result: string;
}

/** Download FAI Report PDF: header, part/supplier info, AQL values, results, signatures. */
export async function recordPdf(db: any, user: any, id: number) {
  const rec: any = await getRecord(db, user, id);
  const lines: FaiInspectionPdfLine[] = (rec.lines ?? []).map((l: any) => ({
    name: l.characteristicName,
    charType: l.charType,
    spec: [l.nominal, l.limitLow && l.limitHigh ? `${l.limitLow} – ${l.limitHigh}` : null, l.unit].filter(Boolean).join(" "),
    measured: l.measuredValue ?? l.attributeResult ?? "",
    result: (l.result ?? "").toUpperCase(),
  }));
  const model = {
    faiNumber: rec.faiNumber,
    partNumber: rec.partNumber,
    supplier: [rec.supplierFactory, rec.receivingLocation].filter(Boolean).join(" / "),
    triggerReason: rec.triggerReason ?? "",
    lotSize: String(rec.lotSize ?? ""),
    sampleSize: String(rec.sampleSize ?? rec.aqlSampleSize ?? ""),
    inspectionLevel: rec.inspectionLevel ?? "",
    severity: rec.severity ?? "",
    codeLetter: rec.codeLetter ?? "",
    aqlValues: `Major ${rec.majorAql ?? ""} (Ac ${rec.acMajor ?? ""} / Re ${rec.reMajor ?? ""}) · Minor ${rec.minorAql ?? ""} (Ac ${rec.acMinor ?? ""} / Re ${rec.reMinor ?? ""})`,
    overallResult: (rec.overallResult ?? rec.status ?? "").toUpperCase(),
    comments: rec.comments ?? "",
    signature: rec.signature ?? "",
    inspected: rec.dateInspected ?? "",
    lines,
  };
  const sections: FormLayout["sections"] = [
    {
      number: "1", title: "FAI Record", blocks: [
        { type: "row", fields: [
          { kind: "text", name: "faiNumber", label: "FAI number" },
          { kind: "text", name: "overallResult", label: "Overall result" },
          { kind: "text", name: "triggerReason", label: "Trigger reason" },
        ]},
        { type: "row", fields: [
          { kind: "text", name: "partNumber", label: "Part number" },
          { kind: "text", name: "supplier", label: "Supplier / location" },
          { kind: "text", name: "inspected", label: "Date inspected" },
        ]},
      ],
    },
    {
      number: "2", title: "AQL Sampling (ANSI/ASQ Z1.4)", blocks: [
        { type: "row", fields: [
          { kind: "text", name: "lotSize", label: "Lot size" },
          { kind: "text", name: "sampleSize", label: "Sample size" },
          { kind: "text", name: "codeLetter", label: "Code letter" },
        ]},
        { type: "row", fields: [
          { kind: "text", name: "inspectionLevel", label: "Inspection level" },
          { kind: "text", name: "severity", label: "Severity" },
          { kind: "text", name: "aqlValues", label: "AQL / Accept / Reject" },
        ]},
      ],
    },
    {
      number: "3", title: "Characteristic results", blocks: [
        { type: "table", name: "lines", columns: [
          { key: "name", label: "Characteristic", kind: "text" },
          { key: "charType", label: "Class", kind: "text" },
          { key: "spec", label: "Spec / limits", kind: "text" },
          { key: "measured", label: "Measured", kind: "text" },
          { key: "result", label: "Result", kind: "text" },
        ]},
      ],
    },
    {
      number: "4", title: "Sign-off", blocks: [
        { type: "row", fields: [
          { kind: "text", name: "signature", label: "Signed by" },
          { kind: "text", name: "comments", label: "Comments" },
        ]},
      ],
    },
  ];
  const layout: FormLayout = { formType: "fai-inspection", title: "FAI Report", sections };
  const built = emptyFrame({
    sourceModule: "FAI & Inspection",
    recordNumber: rec.faiNumber,
    revision: String(rec.planRevision ?? ""),
    generatedBy: "AccuQual",
    status: model.overallResult,
    approvals: rec.signature ? [{ name: rec.signature, role: "", action: "Signed", at: "", status: model.overallResult }] : [],
  });
  const chrome = await loadPdfChrome(db, "fai-inspection", id, {});
  const frame = chrome ? applyChrome(built, chrome) : built;
  const bytes = await renderFormLayoutAsPdf(layout, model, frame);
  return { filename: `FAI-${rec.faiNumber}.pdf`, bytes };
}

export async function renderFaiInspectionPdf(db: any, user: any, id: number) {
  return recordPdf(db, user, id);
}
