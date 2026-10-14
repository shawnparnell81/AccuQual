/**
 * DMA's monthly source spreadsheets, recognized by their header row (never by file name or sheet position).
 * Every row is filed under the month of its own date. A row without a usable date is counted, not guessed.
 */
import ExcelJS from "exceljs";
import { AppError } from "../../utils/appError.js";
import { headerKey } from "./supplierParse.js";

export type SourceKind =
  | "ncr"
  | "qtn"
  | "car"
  | "rpn"
  | "labor_export"
  | "labor_tracker"
  | "fai_csa"
  | "fai_sensor"
  | "fai_fuel"
  | "tech_calls"
  | "product_alerts";

export type SourceValue = string | number | null;
export type SourceData = Record<string, SourceValue>;

export interface SourceRow {
  source: SourceKind;
  rowKey: string;
  month: string;
  data: SourceData;
}

interface KindRule {
  kind: SourceKind;
  label: string;
  /** Header keys (headerKey of the cell text) that must all be on the header row. */
  required: string[];
  /** Header key of the date that files the row under a month. "" = the first column (its header is blank). */
  date: string;
  key: string[];
}

export const SOURCE_LABELS: Record<SourceKind, string> = {
  ncr: "NCR log",
  qtn: "Quarantine (QTN) log",
  car: "CAR log",
  rpn: "RPN log",
  labor_export: "O'Reilly labor claim export",
  labor_tracker: "Labor claim tracker",
  fai_csa: "CSA and Shock FAI tracker",
  fai_sensor: "Lift support and wear sensor FAI tracker",
  fai_fuel: "Fuel FAI tracker",
  tech_calls: "Tech support call log",
  product_alerts: "O'Reilly product alerts",
};

// Order matters where one header set contains another (Fuel before the sensor tab).
const RULES: KindRule[] = [
  { kind: "ncr", label: SOURCE_LABELS.ncr, required: ["ncr_number", "date_opened", "status"], date: "date_opened", key: ["ncr_number"] },
  { kind: "qtn", label: SOURCE_LABELS.qtn, required: ["qtn_number", "date_opened"], date: "date_opened", key: ["qtn_number"] },
  { kind: "car", label: SOURCE_LABELS.car, required: ["car_number", "date_opened"], date: "date_opened", key: ["car_number"] },
  { kind: "rpn", label: SOURCE_LABELS.rpn, required: ["rpn_number", "date_opened"], date: "date_opened", key: ["rpn_number"] },
  {
    kind: "labor_export",
    label: SOURCE_LABELS.labor_export,
    required: ["date_entered", "claim_number", "labor_amount_requested", "total_amount_of_parts"],
    date: "date_entered",
    key: ["claim_number", "item", "line", "rgs_number"],
  },
  { kind: "labor_tracker", label: SOURCE_LABELS.labor_tracker, required: ["rma", "claim", "part", "labor_cost", "dma_part_y_n"], date: "", key: ["rma", "claim", "part"] },
  { kind: "fai_fuel", label: SOURCE_LABELS.fai_fuel, required: ["fai_status", "validation_document", "pn", "1st_fai_disposition", "1st_fai_completion_date"], date: "1st_fai_completion_date", key: ["validation_document", "pn"] },
  { kind: "fai_sensor", label: SOURCE_LABELS.fai_sensor, required: ["validation_document", "dma_pn", "1st_fai_completion_date", "1st_fai_disposition"], date: "1st_fai_completion_date", key: ["validation_document", "dma_pn"] },
  { kind: "fai_csa", label: SOURCE_LABELS.fai_csa, required: ["part", "arrival_date", "completed_date", "disposition"], date: "completed_date", key: ["part", "drawing", "arrival_date", "completed_date"] },
  { kind: "tech_calls", label: SOURCE_LABELS.tech_calls, required: ["dma_initial_contact", "date", "customer_name", "type_of_concern"], date: "date", key: ["date", "customer_name", "part_number", "concern_description_concern"] },
  {
    kind: "product_alerts",
    label: SOURCE_LABELS.product_alerts,
    required: ["product_alert", "date_received", "time_spent_investigating_hours", "status"],
    date: "date_received",
    key: ["product_alert"],
  },
];

export interface SheetResult {
  sheet: string;
  kind: SourceKind | null;
  label: string | null;
  rows: number;
  undated: number;
}

export interface ParsedSourceFile {
  rows: SourceRow[];
  sheets: SheetResult[];
}

/** Text of a header cell, "Part #" and "Part#" both become "part". */
function sourceHeaderKey(value: string): string {
  return headerKey(value.replace(/#/g, " ")).replace(/_+$/, "");
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A real calendar date in a plausible range. Excel serials and "1773-..." leftovers of blank formulas are refused. */
export function usableDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear();
    return year >= 2000 && year <= 2100 ? value : null;
  }
  if (typeof value === "string") {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
    const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
    const date = iso ? new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))) : us ? new Date(Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2]))) : null;
    return date ? usableDate(date) : null;
  }
  return null;
}

function cellValue(value: ExcelJS.CellValue): SourceValue | Date {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? "Y" : "N";
  if (typeof value === "string") return value.trim() === "" ? null : value.trim().slice(0, 2000);
  if (typeof value === "object") {
    if ("result" in value) return cellValue((value as { result?: ExcelJS.CellValue }).result ?? null);
    if ("richText" in value && Array.isArray(value.richText)) return cellValue(value.richText.map((part) => part.text).join(""));
    if ("text" in value) return cellValue(String((value as { text?: unknown }).text ?? ""));
    if ("error" in value) return null;
  }
  return null;
}

function matchRule(keys: string[]): KindRule | null {
  const present = new Set(keys);
  return RULES.find((rule) => rule.required.every((key) => present.has(key))) ?? null;
}

export async function parseSourceWorkbook(buffer: Buffer, fileName: string): Promise<ParsedSourceFile> {
  if (!/\.xlsx$/i.test(fileName)) throw AppError.badRequest("Upload the source spreadsheet as an Excel file (.xlsx).");
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw AppError.badRequest("That file could not be read as an Excel workbook.");
  }
  const rows: SourceRow[] = [];
  const sheets: SheetResult[] = [];
  workbook.eachSheet((sheet) => {
    const grid: (SourceValue | Date)[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const values = row.values as ExcelJS.CellValue[];
      const cells: (SourceValue | Date)[] = [];
      for (let column = 1; column < Math.max(values.length, 2); column += 1) cells.push(cellValue(values[column] ?? null));
      grid[rowNumber - 1] = cells;
    });
    let headerAt = -1;
    let rule: KindRule | null = null;
    let keys: string[] = [];
    for (let index = 0; index < Math.min(grid.length, 12); index += 1) {
      const candidate = (grid[index] ?? []).map((cell) => (typeof cell === "string" ? sourceHeaderKey(cell) : ""));
      const found = matchRule(candidate);
      if (found) {
        headerAt = index;
        rule = found;
        keys = candidate;
        break;
      }
    }
    if (!rule) {
      sheets.push({ sheet: sheet.name, kind: null, label: null, rows: 0, undated: 0 });
      return;
    }
    const dateIndex = rule.date === "" ? 0 : keys.indexOf(rule.date);
    let count = 0;
    let undated = 0;
    // A log can list the same number twice on purpose (one claim, two lines). The second one keeps its own key, "#2".
    const seen = new Map<string, number>();
    for (const cells of grid.slice(headerAt + 1)) {
      if (!cells || cells.every((cell) => cell == null)) continue;
      const date = usableDate(cells[dateIndex]);
      if (!date) {
        undated += 1;
        continue;
      }
      const data: SourceData = {};
      keys.forEach((key, index) => {
        if (!key || key in data) return;
        const value = cells[index] ?? null;
        data[key] = value instanceof Date ? (usableDate(value) ? isoDay(value) : null) : value;
      });
      data.__date = isoDay(date);
      const keyParts = rule.key.map((name) => String(data[name] ?? "").trim().toLowerCase());
      if (keyParts.every((part) => part === "")) {
        undated += 1;
        continue;
      }
      const base = keyParts.join("|");
      const occurrence = (seen.get(base) ?? 0) + 1;
      seen.set(base, occurrence);
      rows.push({ source: rule.kind, rowKey: occurrence === 1 ? base : `${base}#${occurrence}`, month: isoDay(date).slice(0, 7), data });
      count += 1;
    }
    sheets.push({ sheet: sheet.name, kind: rule.kind, label: rule.label, rows: count, undated });
  });
  if (rows.length === 0) {
    throw AppError.badRequest("No monthly source rows were found. The file needs a recognized header row (NCR log, labor claims, FAI trackers, tech calls or product alerts) and dated rows.");
  }
  // The same row can sit on two tabs of one workbook (an older copy of a sheet). The first tab wins.
  const unique = new Map<string, SourceRow>();
  for (const row of rows) {
    const id = `${row.source}\u0000${row.rowKey}`;
    if (!unique.has(id)) unique.set(id, row);
  }
  return { rows: [...unique.values()], sheets };
}
