import { assertSavedCopy, parseSheetLayout, renderLayoutPdf } from "./layoutPdf.js";
import type { Db } from "../../lib/requestDb.js";
import type { FormLayout, TableColumn } from "../forms/layouts/types.js";
import { renderFormLayoutAsPdf } from "../forms/schema-pdf-renderer.js";
import { emptyFrame } from "../forms/controlledPdf.js";
import { applyChrome, loadPdfChrome, persistPdfExport } from "../pdf-exports/pdfExportStore.js";

export interface SheetTable {
  title: string;
  columns: { key: string; label: string }[];
  rows: Record<string, string>[];
}

export interface SheetRecord {
  entityType: string;
  entityId: number;
  title: string;
  formNumber: string;
  recordNumber: string;
  revision: string;
  status?: string | null;
  header: { label: string; value: string }[];
  tables: SheetTable[];
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/** Typed sheet cells (A1-style keys) as one table, one line per filled row. */
export function cellsTable(cells: Record<string, unknown>, title = "Sheet"): SheetTable {
  const byRow = new Map<number, Record<string, string>>();
  const columns = new Set<string>();
  for (const [addr, value] of Object.entries(cells)) {
    const match = /^([A-Z]+)(\d+)$/.exec(addr);
    const value_ = text(value).trim();
    if (!match || !value_) continue;
    const row = Number(match[2]);
    columns.add(match[1]!);
    const line = byRow.get(row) ?? { row: String(row) };
    line[match[1]!] = value_;
    byRow.set(row, line);
  }
  const ordered = [...columns].sort((a, b) => a.length - b.length || a.localeCompare(b));
  return {
    title,
    columns: [{ key: "row", label: "Row" }, ...ordered.map((key) => ({ key, label: key }))],
    rows: [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([, line]) => line),
  };
}

/**
 * Controlled PDF for a saved sheet-style record (ISO forms, QMS forms). The
 * revision printed is the one stored on the record; this never changes it.
 * The export is stored like every other controlled PDF so it can be verified.
 */
export async function renderSheetRecordPdf(db: Db, record: SheetRecord, actor: { id?: number; name?: string | null }) {
  const headerData: Record<string, unknown> = {};
  const headerFields = record.header.map((item, index) => {
    headerData[`h${index}`] = item.value;
    return { kind: "text" as const, name: `h${index}`, label: item.label };
  });
  const rowsOfThree = [];
  for (let i = 0; i < headerFields.length; i += 3) rowsOfThree.push({ type: "row" as const, fields: headerFields.slice(i, i + 3) });
  const data: Record<string, unknown> = { ...headerData };
  const layout: FormLayout = {
    formType: record.entityType,
    title: record.title,
    sections: [
      { number: "1", title: "Header", blocks: rowsOfThree },
      ...record.tables.map((table, index) => {
        const name = `t${index}`;
        data[name] = table.rows;
        const columns: TableColumn[] = table.columns.map((column) => ({ key: column.key, label: column.label, kind: "text" as const }));
        return { number: String(index + 2), title: table.title, blocks: [{ type: "table" as const, name, columns }] };
      }),
    ],
  };
  const generatedBy = actor.name?.trim() || "AccuQual";
  const built = emptyFrame({
    sourceModule: record.title,
    recordNumber: record.recordNumber,
    revision: record.revision,
    generatedBy,
    formNumber: record.formNumber || null,
    status: record.status ?? null,
  });
  const chrome = await loadPdfChrome(db, record.entityType, record.entityId, data);
  const frame = applyChrome(built, chrome);
  const bytes = await renderFormLayoutAsPdf(layout, data, frame);
  await persistPdfExport(db, bytes, frame, { entityType: record.entityType, entityId: record.entityId, actorId: actor.id });
  return { bytes, exportId: chrome.exportId };
}

export function sendPdf(res: { setHeader(k: string, v: string): void; send(b: Buffer): void }, bytes: Uint8Array, exportId: string, fileBase: string) {
  res.setHeader("Content-Type", "application/pdf");
  if (exportId) res.setHeader("X-Export-Id", exportId);
  const safe = fileBase.replace(/[^a-zA-Z0-9._-]+/g, "-") || "record";
  res.setHeader("Content-Disposition", `attachment; filename="${safe}.pdf"`);
  res.send(Buffer.from(bytes));
}

/** Every leaf value of the stored record, for the saved-copy check. */
export function savedLeaves(...sources: unknown[]): unknown[] {
  const out: unknown[] = [];
  const walk = (value: unknown, depth: number) => {
    if (depth > 12 || value == null) return;
    if (Array.isArray(value)) value.forEach((v) => walk(v, depth + 1));
    else if (typeof value === "object") Object.values(value as Record<string, unknown>).forEach((v) => walk(v, depth + 1));
    else out.push(value);
  };
  sources.forEach((s) => walk(s, 0));
  return out;
}

/**
 * Draws the form exactly as it was laid out on screen. The browser sends the
 * captured layout; the chrome, record number and revision come from the
 * stored record, and every field value must match what is saved.
 */
export async function renderLayoutRecordPdf(
  db: Db,
  record: Omit<SheetRecord, "header" | "tables">,
  body: unknown,
  saved: unknown[],
  actor: { id?: number; name?: string | null },
) {
  const layout = parseSheetLayout(body);
  assertSavedCopy(layout, saved);
  const built = emptyFrame({
    sourceModule: record.title,
    recordNumber: record.recordNumber,
    revision: record.revision,
    generatedBy: actor.name?.trim() || "AccuQual",
    formNumber: record.formNumber || null,
    status: record.status ?? null,
  });
  const chrome = await loadPdfChrome(db, record.entityType, record.entityId, {});
  const frame = applyChrome(built, chrome);
  const { bytes } = await renderLayoutPdf({ layout, frame, title: record.title });
  await persistPdfExport(db, bytes, frame, { entityType: record.entityType, entityId: record.entityId, actorId: actor.id });
  return { bytes, exportId: chrome.exportId };
}
