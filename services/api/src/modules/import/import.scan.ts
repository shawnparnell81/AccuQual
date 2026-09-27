import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/appError.js";

export const MAX_ADMIN_IMPORT_ROWS = 250_000;
export const MAX_IMPORT_COLUMNS = 60;

export interface ScannedRow {
  number: number;
  cells: string[];
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.richText)) return record.richText.map((part) => String((part as { text?: string }).text ?? "")).join("").trim();
    if ("result" in record) return cellToString(record.result);
    if ("text" in record) return String(record.text ?? "").trim();
    return "";
  }
  return String(value).trim();
}

/** Reads one CSV file without holding the whole sheet in memory. Quoted commas and line breaks stay inside the cell. */
export async function readCsvRows(filePath: string, onRow: (row: ScannedRow) => Promise<void> | void): Promise<void> {
  const root = path.resolve(env.STORAGE_LOCAL_PATH) + path.sep;
  const stored = path.resolve(filePath);
  if (!stored.startsWith(root)) throw AppError.badRequest("That file couldn't be read. Upload an Excel (.xlsx or .xls) or CSV file.");
  const stream = createReadStream(stored, { encoding: "utf8" });
  let field = "";
  let cells: string[] = [];
  let inQuotes = false;
  let rowNumber = 1;
  let sawChar = false;

  const emit = async () => {
    cells.push(field.trim());
    field = "";
    if (cells.some((cell) => cell !== "")) await onRow({ number: rowNumber, cells });
    cells = [];
    rowNumber += 1;
  };

  for await (const chunk of stream) {
    const text = sawChar ? String(chunk) : String(chunk).replace(/^\uFEFF/, "");
    sawChar = true;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 1;
          } else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        cells.push(field.trim());
        field = "";
      } else if (ch === "\n") await emit();
      else if (ch !== "\r") field += ch;
    }
  }
  if (field.length > 0 || cells.length > 0) await emit();
}

async function readXlsxRows(filePath: string, onRow: (row: ScannedRow) => Promise<void> | void): Promise<void> {
  const root = path.resolve(env.STORAGE_LOCAL_PATH) + path.sep;
  const stored = path.resolve(filePath);
  if (!stored.startsWith(root)) throw AppError.badRequest("That file couldn't be read. Upload an Excel (.xlsx or .xls) or CSV file.");
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(stored, {
    entries: "emit",
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "ignore",
    worksheets: "emit",
  });
  for await (const worksheet of reader) {
    for await (const row of worksheet) {
      const values = (row.values ?? []) as unknown[];
      const width = Math.min(Math.max(values.length - 1, 0), MAX_IMPORT_COLUMNS);
      const cells: string[] = [];
      for (let c = 1; c <= width; c++) cells.push(cellToString(values[c]));
      if (cells.some((cell) => cell !== "")) await onRow({ number: row.number, cells });
    }
    break;
  }
}

/** Legacy .xls (BIFF). ExcelJS does not read that format. The dependency is the patched SheetJS build, not the unfixed copy on npm. */
async function readXlsRows(filePath: string, onRow: (row: ScannedRow) => Promise<void> | void): Promise<void> {
  const root = path.resolve(env.STORAGE_LOCAL_PATH) + path.sep;
  const stored = path.resolve(filePath);
  if (!stored.startsWith(root)) throw AppError.badRequest("That file couldn't be read. Upload an Excel (.xlsx or .xls) or CSV file.");
  const book = XLSX.read(await readFile(stored), { type: "buffer", cellDates: true });
  const name = book.SheetNames[0];
  if (!name) return;
  const sheet = book.Sheets[name];
  if (!sheet?.["!ref"]) return;
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const lastCol = Math.min(range.e.c, range.s.c + MAX_IMPORT_COLUMNS - 1);
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells: string[] = [];
    for (let c = range.s.c; c <= lastCol; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })] as { w?: string; v?: unknown } | undefined;
      cells.push(cell ? cellToString(cell.w ?? cell.v) : "");
    }
    if (cells.some((cell) => cell !== "")) await onRow({ number: r + 1, cells });
  }
}

/**
 * Walks the first sheet of a CSV, .xlsx, or .xls file one row at a time.
 * Returns the header and how many data rows there were. The caller keeps only what it needs.
 */
export async function scanSpreadsheet(filePath: string, fileName: string, onDataRow: (row: ScannedRow) => Promise<void> | void): Promise<{ headers: string[]; totalRows: number }> {
  const lower = fileName.toLowerCase();
  let headers: string[] | null = null;
  let totalRows = 0;
  const take = async (row: ScannedRow) => {
    if (!headers) {
      if (row.cells.length > MAX_IMPORT_COLUMNS) throw AppError.badRequest(`The sheet has more than ${MAX_IMPORT_COLUMNS} columns. Keep just the columns you want to import.`);
      headers = row.cells.map((text, i) => text || `Column ${i + 1}`);
      return;
    }
    totalRows += 1;
    if (totalRows > MAX_ADMIN_IMPORT_ROWS) throw AppError.badRequest(`The file has more than ${MAX_ADMIN_IMPORT_ROWS.toLocaleString()} rows. Split it into smaller files.`);
    await onDataRow({ number: row.number, cells: row.cells });
  };

  try {
    if (lower.endsWith(".csv")) await readCsvRows(filePath, take);
    else if (lower.endsWith(".xls")) await readXlsRows(filePath, take);
    else await readXlsxRows(filePath, take);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw AppError.badRequest("That file couldn't be read. Upload an Excel (.xlsx or .xls) or CSV file.");
  }

  if (!headers) throw AppError.badRequest("The file has no data in it.");
  if (totalRows === 0) throw AppError.badRequest("The file has a header row but no data rows under it.");
  return { headers, totalRows };
}
