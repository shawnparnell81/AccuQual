import type { FormLayout, TableColumn } from "../forms/layouts/types.js";
import { renderFormLayoutAsPdf } from "../forms/schema-pdf-renderer.js";
import { emptyFrame, type ApprovalLine } from "../forms/controlledPdf.js";
import { applyChrome, type PdfChrome } from "../pdf-exports/pdfExportStore.js";

/** Titles and revisions already used by the validation sheets in the app. */
const TITLES: Record<string, { title: string; revision: string }> = {
  csa: { title: "CSA VALIDATION REPORT", revision: "C" },
  fuel_pump: { title: "FUEL PUMP VALIDATION DOCUMENT", revision: "C" },
  air_strut: { title: "FRM-VAL-010 AIR STRUT VALIDATION DOCUMENT", revision: "A" },
  air_spring: { title: "FRM-VAL-011 AIR STRUT VALIDATION DOCUMENT", revision: "A" },
  fuel_injector: { title: "FRM-VAL-008 FUEL INJECTOR VALIDATION DOCUMENT", revision: "B" },
  brake_wear: { title: "FRM-VAL-009 BRAKE WEAR SENSOR VALIDATION DOCUMENT", revision: "A" },
  shock: { title: "FRM-VAL-002 SHOCK VALIDATION REPORT", revision: "B" },
  air_compressor: { title: "FRM-VAL-003 AIR COMPRESSOR VALIDATION DOCUMENT", revision: "A" },
  electric_lift: { title: "FRM-VAL-004 ELECTRIC LIFT SUPPORT VALIDATION DOCUMENT", revision: "B" },
  gas_lift: { title: "FRM-VAL-005 GAS LIFT SUPPORT VALIDATION DOCUMENT", revision: "B" },
  coil_spring: { title: "FRM-VAL-006 COIL SPRING VALIDATION DOCUMENT", revision: "A" },
};

function cellText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export function validationExportIdentity(data: Record<string, unknown>, generatedBy: string) {
  const kind = typeof data.formType === "string" && TITLES[data.formType] ? data.formType : "csa";
  const meta = TITLES[kind]!;
  const cells = data.cells && typeof data.cells === "object" && !Array.isArray(data.cells) ? (data.cells as Record<string, unknown>) : {};
  return { sourceModule: meta.title, recordNumber: cellText(cells.B6), revision: meta.revision, generatedBy, formNumber: meta.title };
}

/** Sheet order: header cells, then one row per filled sheet row. */
export async function renderValidationReportPdf(data: Record<string, unknown>, generatedBy: string, chrome?: PdfChrome | null): Promise<Uint8Array> {
  const kind = typeof data.formType === "string" && TITLES[data.formType] ? data.formType : "csa";
  const meta = TITLES[kind]!;
  const cells = data.cells && typeof data.cells === "object" && !Array.isArray(data.cells) ? (data.cells as Record<string, unknown>) : {};
  const byRow = new Map<number, Record<string, string>>();
  const columns = new Set<string>();
  for (const [addr, value] of Object.entries(cells)) {
    const match = /^([A-Z]+)(\d+)$/.exec(addr);
    if (!match) continue;
    const text = cellText(value);
    if (!text) continue;
    const row = Number(match[2]);
    columns.add(match[1]!);
    const line = byRow.get(row) ?? { row: String(row) };
    line[match[1]!] = text;
    byRow.set(row, line);
  }
  const orderedColumns = [...columns].sort();
  const tableColumns: TableColumn[] = [
    { key: "row", label: "Row", kind: "text" },
    ...orderedColumns.map((key) => ({ key, label: key, kind: "text" as const })),
  ];
  const rows = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([, line]) => line);
  const approvals: ApprovalLine[] = [];
  for (const key of ["authorizedSignature", "furtherSignature"] as const) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) approvals.push({ name: value.trim(), role: "", action: "Signed", at: "", status: "Approved" });
  }
  const layout: FormLayout = {
    formType: `validation_${kind}`,
    title: meta.title,
    sections: [
      {
        number: "1",
        title: "Header",
        blocks: [
          {
            type: "row",
            fields: [
              { kind: "text", name: "part", label: "Part" },
              { kind: "text", name: "drawing", label: "Drawing" },
              { kind: "text", name: "description", label: "Description" },
            ],
          },
        ],
      },
      {
        number: "2",
        title: "Sheet",
        blocks: [{ type: "table", name: "rows", columns: tableColumns.length > 1 ? tableColumns : [{ key: "row", label: "Row", kind: "text" }, { key: "value", label: "Value", kind: "text" }] }],
      },
    ],
  };
  const built = emptyFrame({
    sourceModule: meta.title,
    recordNumber: cellText(cells.B6),
    revision: meta.revision,
    generatedBy,
    formNumber: meta.title,
    approvals,
  });
  const frame = chrome ? applyChrome(built, chrome) : built;
  return renderFormLayoutAsPdf(
    layout,
    {
      part: cellText(cells.B6),
      drawing: cellText(cells.F6) || cellText(cells.G6),
      description: cellText(cells.B7),
      rows,
    },
    frame,
  );
}
