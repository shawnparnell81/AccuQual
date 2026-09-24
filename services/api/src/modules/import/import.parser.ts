import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { AppError } from "../../utils/appError.js";

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_COLUMNS = 60;

export interface ParsedRow {
  /** The row's number in the spreadsheet as the person sees it (header is row 1 in a plain sheet). */
  number: number;
  cells: string[];
}

export interface ParsedSheet {
  headers: string[];
  rows: ParsedRow[];
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((part) => part.text).join("").trim();
    if ("result" in value) return cellToString(value.result as ExcelJS.CellValue);
    if ("text" in value) return String(value.text ?? "").trim();
    if ("error" in value) return "";
    return "";
  }
  return String(value).trim();
}

/** Reads the first sheet of an .xlsx, or a .csv, into a header row plus data rows. Blank rows are dropped; formulas read as their calculated value. */
export async function parseSpreadsheet(buffer: Buffer, fileName: string): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  const isCsv = fileName.toLowerCase().endsWith(".csv");
  let sheet: ExcelJS.Worksheet | undefined;
  try {
    if (isCsv) sheet = await workbook.csv.read(Readable.from(buffer));
    else {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
      sheet = workbook.worksheets.find((ws) => ws.actualRowCount > 0);
    }
  } catch {
    throw AppError.badRequest("That file couldn't be read. Upload an Excel (.xlsx) or CSV file.");
  }
  if (!sheet) throw AppError.badRequest("The file has no data in it.");

  const width = Math.min(sheet.actualColumnCount, MAX_IMPORT_COLUMNS + 1);
  if (sheet.actualColumnCount > MAX_IMPORT_COLUMNS) throw AppError.badRequest(`The sheet has more than ${MAX_IMPORT_COLUMNS} columns. Keep just the columns you want to import.`);

  const collected: ParsedRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) cells.push(cellToString(row.getCell(c).value));
    if (cells.some((cell) => cell !== "")) collected.push({ number: rowNumber, cells });
  });

  const header = collected.shift();
  if (!header) throw AppError.badRequest("The file has no data in it.");
  if (collected.length === 0) throw AppError.badRequest("The file has a header row but no data rows under it.");
  if (collected.length > MAX_IMPORT_ROWS) throw AppError.badRequest(`The file has ${collected.length} rows. Import at most ${MAX_IMPORT_ROWS} at a time.`);

  const headers = header.cells.map((text, i) => text || `Column ${i + 1}`);
  return { headers, rows: collected };
}
