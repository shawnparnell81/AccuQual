import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { AppError } from "../../utils/appError.js";
import {
  emptySupplierData,
  type EmailIssueMonth,
  type FaiCategoryRow,
  type FinancialMonth,
  type MonthMetric,
  type SupplierData,
  type SupplierNote,
  type WarrantyMonth,
} from "./model.js";

export const MAX_SUPPLIER_ROWS = 5000;

const DATASETS = new Set([
  "monthly_metrics",
  "financials",
  "warranty_metrics",
  "claims_series",
  "top_parts",
  "top_vehicles",
  "fuel_pump_returns",
  "executive",
  "product_alerts",
  "fai_categories",
  "email_issues",
  "notes",
]);

const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

export interface ParseResult {
  data: SupplierData;
  warnings: string[];
}

export function headerKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
}

function yearMonth(year: number, month: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12 || year < 1990 || year > 2200) return null;
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function parseMonthKey(value: string, fallbackYear?: number): string | null {
  const text = value.trim();
  if (!text) return null;
  let match = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?(?:[tT ].*)?$/.exec(text);
  if (match) return yearMonth(Number(match[1]), Number(match[2]));
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (match) return yearMonth(Number(match[3]), Number(match[1]));
  match = /^(\d{1,2})\/(\d{4})$/.exec(text);
  if (match) return yearMonth(Number(match[2]), Number(match[1]));
  match = /^([A-Za-z]+)\s+(\d{4})$/.exec(text);
  if (match) {
    const month = MONTH_INDEX[match[1]!.toLowerCase()];
    if (month) return yearMonth(Number(match[2]), month);
  }
  const named = MONTH_INDEX[text.toLowerCase()];
  if (named && fallbackYear) return yearMonth(fallbackYear, named);
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
    return yearMonth(utc.getUTCFullYear(), utc.getUTCMonth() + 1);
  }
  return null;
}

export function parseDay(value: string): string | null {
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (us) {
    const month = String(Number(us[1])).padStart(2, "0");
    const day = String(Number(us[2])).padStart(2, "0");
    return `${us[3]}-${month}-${day}`;
  }
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(text)) * 86_400_000);
    const month = String(utc.getUTCMonth() + 1).padStart(2, "0");
    const day = String(utc.getUTCDate()).padStart(2, "0");
    return `${utc.getUTCFullYear()}-${month}-${day}`;
  }
  return null;
}

export function parseNumber(value: string): number | null {
  const cleaned = value.replace(/[$,]/g, "").trim();
  if (!cleaned || /^n\/?a$/i.test(cleaned) || cleaned === "—" || cleaned === "-" || cleaned === "#DIV/0!") return null;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}

function datasetName(value: string): string | null {
  const key = headerKey(value);
  return DATASETS.has(key) ? key : null;
}

function cell(row: string[], index: Map<string, number>, ...names: string[]): string {
  for (const name of names) {
    const at = index.get(name);
    if (at == null) continue;
    const value = row[at];
    if (value != null && value.trim() !== "") return value.trim();
  }
  return "";
}

function indexHeaders(headers: string[]): Map<string, number> {
  const index = new Map<string, number>();
  headers.forEach((header, position) => {
    const key = headerKey(header);
    if (key && !index.has(key)) index.set(key, position);
  });
  return index;
}

function pushCapped<T>(list: T[], row: T, warnings: string[], label: string): void {
  if (list.length >= MAX_SUPPLIER_ROWS) {
    if (warnings.length < 20) warnings.push(`${label} stopped at ${MAX_SUPPLIER_ROWS} rows.`);
    return;
  }
  list.push(row);
}

function absorb(data: SupplierData, dataset: string, headers: string[], rows: string[][], warnings: string[], fallbackYear?: number): void {
  const index = indexHeaders(headers);
  rows.forEach((row, offset) => {
    const line = offset + 2;
    if (dataset === "monthly_metrics") {
      const month = parseMonthKey(cell(row, index, "month", "period"), fallbackYear);
      if (!month) {
        warnings.push(`monthly_metrics row ${line} has no month.`);
        return;
      }
      const metric: MonthMetric = {
        month,
        totalClaims: parseNumber(cell(row, index, "total_claims", "claims", "claim_count")),
        totalProductAlerts: parseNumber(cell(row, index, "total_product_alerts", "product_alerts", "alerts")),
      };
      pushCapped(data.monthlyMetrics, metric, warnings, "monthly_metrics");
      return;
    }
    if (dataset === "financials") {
      const month = parseMonthKey(cell(row, index, "month", "period"), fallbackYear);
      if (!month) {
        warnings.push(`financials row ${line} has no month.`);
        return;
      }
      const item: FinancialMonth = {
        month,
        totalAmount: parseNumber(cell(row, index, "total_amount_requested", "total_amount", "total")),
        partsAmount: parseNumber(cell(row, index, "parts_amount_requested", "parts_amount", "parts")),
        laborAmount: parseNumber(cell(row, index, "labor_amount_requested", "labor_amount", "labor")),
      };
      pushCapped(data.financials, item, warnings, "financials");
      return;
    }
    if (dataset === "warranty_metrics") {
      const month = parseMonthKey(cell(row, index, "month", "period"), fallbackYear);
      if (!month) {
        warnings.push(`warranty_metrics row ${line} has no month.`);
        return;
      }
      const ratioRaw = cell(row, index, "labor_to_parts_ratio", "labor_to_parts", "ratio");
      const item: WarrantyMonth = {
        month,
        laborToPartsRatio: ratioRaw ? ratioRaw : null,
        mttfDays: parseNumber(cell(row, index, "mean_time_to_failure_days", "mttf", "mttf_days", "mean_time_to_failure")),
        medianDays: parseNumber(cell(row, index, "median_time_to_failure_days", "median_ttf", "median_days", "median_time_to_failure")),
      };
      pushCapped(data.warrantyMetrics, item, warnings, "warranty_metrics");
      return;
    }
    if (dataset === "claims_series") {
      const date = parseDay(cell(row, index, "date", "day"));
      const claims = parseNumber(cell(row, index, "claims", "claim_count"));
      const returns = parseNumber(cell(row, index, "returns", "return_count"));
      if (!date || claims == null || returns == null) {
        warnings.push(`claims_series row ${line} needs a date, claims, and returns.`);
        return;
      }
      pushCapped(data.claimsSeries, { date, claims, returns }, warnings, "claims_series");
      return;
    }
    if (dataset === "top_parts") {
      const partNumber = cell(row, index, "part_number", "part", "sku");
      const totalClaims = parseNumber(cell(row, index, "total_claims", "claims", "claim_count"));
      if (!partNumber || totalClaims == null) {
        warnings.push(`top_parts row ${line} needs a part number and a claim count.`);
        return;
      }
      pushCapped(data.topParts, { partNumber, description: cell(row, index, "description", "application", "description_application"), totalClaims }, warnings, "top_parts");
      return;
    }
    if (dataset === "top_vehicles") {
      const vehicle = cell(row, index, "vehicle", "model", "vehicle_model");
      const claims = parseNumber(cell(row, index, "claims", "total_claims", "claim_count"));
      if (!vehicle || claims == null) {
        warnings.push(`top_vehicles row ${line} needs a vehicle and a claim count.`);
        return;
      }
      pushCapped(data.topVehicles, { vehicle, claims }, warnings, "top_vehicles");
      return;
    }
    if (dataset === "fuel_pump_returns") {
      const source = cell(row, index, "source", "name", "supplier");
      const count = parseNumber(cell(row, index, "count", "claims", "total"));
      if (!source || count == null) {
        warnings.push(`fuel_pump_returns row ${line} needs a source and a count.`);
        return;
      }
      pushCapped(data.fuelPumpReturns, { source, count }, warnings, "fuel_pump_returns");
      return;
    }
    if (dataset === "executive") {
      const key = headerKey(cell(row, index, "key", "name", "field"));
      const value = cell(row, index, "value", "amount", "figure");
      if (key) data.executive[key] = value;
      for (const name of ["raw_claim_count", "tracker_processed", "flat_rate", "potential_liability", "claims_approved", "claims_denied", "claims_pending", "denied_labor_savings", "department_status"]) {
        const direct = cell(row, index, name);
        if (direct) data.executive[name] = direct;
      }
      return;
    }
    if (dataset === "product_alerts") {
      data.productAlerts = {
        total: parseNumber(cell(row, index, "total", "total_product_alerts")),
        open: parseNumber(cell(row, index, "open_count", "open")),
        hoursSpent: parseNumber(cell(row, index, "hours_spent", "hours")),
        avgDaysToClose: parseNumber(cell(row, index, "avg_days_to_close", "avg_days", "average_days_to_close")),
      };
      return;
    }
    if (dataset === "fai_categories") {
      const category = cell(row, index, "category", "product_category");
      if (!category || category.toLowerCase() === "total") return;
      const item: FaiCategoryRow = {
        category,
        totalCompleted: parseNumber(cell(row, index, "total_completed", "completed", "total")) ?? 0,
        passed: parseNumber(cell(row, index, "passed", "pass")) ?? 0,
        failed: parseNumber(cell(row, index, "failed", "fail")) ?? 0,
        passedWithDeviation: parseNumber(cell(row, index, "passed_with_deviation", "deviation", "passed_w_deviation")) ?? 0,
      };
      pushCapped(data.faiCategories, item, warnings, "fai_categories");
      return;
    }
    if (dataset === "email_issues") {
      const month = parseMonthKey(cell(row, index, "month", "period"), fallbackYear);
      if (!month) {
        warnings.push(`email_issues row ${line} has no month.`);
        return;
      }
      const item: EmailIssueMonth = {
        month,
        totalIssues: parseNumber(cell(row, index, "total_issues", "total")),
        orIssues: parseNumber(cell(row, index, "or_issues", "oreilly", "o_reilly")),
        napaIssues: parseNumber(cell(row, index, "napa_issues", "napa")),
      };
      pushCapped(data.emailIssues, item, warnings, "email_issues");
      return;
    }
    if (dataset === "notes") {
      const section = headerKey(cell(row, index, "section", "topic"));
      const problem = cell(row, index, "problem", "text", "note", "question");
      const response = cell(row, index, "response", "answer");
      if (!section || (!problem && !response)) return;
      const note: SupplierNote = { section, problem, response };
      pushCapped(data.notes, note, warnings, "notes");
    }
  });
}

function sheetsFromGrid(name: string, grid: string[][]): Array<{ dataset: string; headers: string[]; rows: string[][] }> {
  if (grid.length === 0) return [];
  const headers = grid[0]!.map((cell) => cell.trim());
  const body = grid.slice(1);
  const named = datasetName(name);
  const datasetColumn = indexHeaders(headers).get("dataset");
  if (named && datasetColumn == null) return [{ dataset: named, headers, rows: body }];
  if (datasetColumn == null) return [];
  const groups = new Map<string, string[][]>();
  for (const row of body) {
    const dataset = datasetName(row[datasetColumn] ?? "");
    if (!dataset) continue;
    const list = groups.get(dataset) ?? [];
    list.push(row);
    groups.set(dataset, list);
  }
  return [...groups.entries()].map(([dataset, rows]) => ({ dataset, headers, rows }));
}

function readXlsGrid(sheet: XLSX.WorkSheet): string[][] {
  const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, { header: 1, raw: false, defval: "" });
  return rows.map((row) => row.map((value) => (value == null ? "" : String(value))));
}

async function gridsFromExcelJs(buffer: Buffer): Promise<Array<{ name: string; grid: string[][] }>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const grids: Array<{ name: string; grid: string[][] }> = [];
  workbook.eachSheet((sheet) => {
    const grid: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      const values = row.values;
      if (!Array.isArray(values)) return;
      for (let column = 1; column < values.length; column += 1) {
        const value = values[column];
        if (value == null) cells.push("");
        else if (value instanceof Date) cells.push(value.toISOString().slice(0, 10));
        else if (typeof value === "object" && "result" in value) cells.push(value.result == null ? "" : String(value.result));
        else if (typeof value === "object" && "richText" in value && Array.isArray(value.richText)) cells.push(value.richText.map((part) => part.text).join(""));
        else if (typeof value === "object" && "text" in value) cells.push(String(value.text ?? ""));
        else cells.push(String(value));
      }
      grid.push(cells);
    });
    grids.push({ name: sheet.name, grid });
  });
  return grids;
}

export async function parseSupplierFile(buffer: Buffer, fileName: string, fallbackYear?: number): Promise<ParseResult> {
  const lower = fileName.toLowerCase();
  const data = emptySupplierData();
  const warnings: string[] = [];
  let sheets: Array<{ dataset: string; headers: string[]; rows: string[][] }> = [];

  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    const grid = parseCsv(buffer.toString("utf8"));
    sheets = sheetsFromGrid("upload", grid);
  } else if (lower.endsWith(".xlsx")) {
    const grids = await gridsFromExcelJs(buffer);
    sheets = grids.flatMap((grid) => sheetsFromGrid(grid.name, grid.grid));
  } else if (lower.endsWith(".xls")) {
    const book = XLSX.read(buffer, { type: "buffer" });
    sheets = book.SheetNames.flatMap((name) => sheetsFromGrid(name, readXlsGrid(book.Sheets[name]!)));
  } else {
    throw AppError.badRequest("Upload a CSV or Excel file (.csv, .xlsx, or .xls).");
  }

  if (sheets.length === 0) {
    throw AppError.badRequest("No supplier datasets were found. Use a dataset column, or name each Excel sheet after a dataset (monthly_metrics, financials, claims_series, and the others listed in the help note).");
  }

  for (const sheet of sheets) absorb(data, sheet.dataset, sheet.headers, sheet.rows, warnings, fallbackYear);
  const populated =
    data.monthlyMetrics.length +
    data.financials.length +
    data.warrantyMetrics.length +
    data.claimsSeries.length +
    data.topParts.length +
    data.topVehicles.length +
    data.fuelPumpReturns.length +
    Object.keys(data.executive).length +
    (data.productAlerts ? 1 : 0) +
    data.faiCategories.length +
    data.emailIssues.length +
    data.notes.length;
  if (populated === 0) throw AppError.badRequest("The file was read, but none of the rows had usable supplier columns.");
  return { data, warnings };
}
