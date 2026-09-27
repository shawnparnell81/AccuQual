import type ExcelJS from "exceljs";
import {
  borderCss,
  columnWidthPx,
  cssColor,
  excelSerialToDate,
  formatDateValue,
  formatNumberValue,
  gridFromRows,
  isDateFormat,
  parseCsv,
  textOnFill,
  type CellStyle,
  type GridCell,
  type SheetGrid,
  type WorkbookColor,
  MAX_PREVIEW_COLS,
  MAX_PREVIEW_ROWS,
} from "./spreadsheetFormat";

export type { SheetGrid, GridCell, CellStyle };
export { MAX_PREVIEW_COLS, MAX_PREVIEW_ROWS };

export interface SpreadsheetBook {
  sheets: SheetGrid[];
}

type ExcelModule = typeof import("exceljs");

function looksLikeZip(data: ArrayBuffer): boolean {
  const bytes = new Uint8Array(data);
  return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function plainValue(value: ExcelJS.CellValue, numFmt?: string): string {
  if (value == null) return "";
  if (value instanceof Date) return formatDateValue(value, numFmt);
  if (typeof value === "number") {
    if (numFmt && isDateFormat(numFmt)) return formatDateValue(excelSerialToDate(value), numFmt);
    return formatNumberValue(value, numFmt);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
    if ("result" in value) return plainValue(value.result as ExcelJS.CellValue, numFmt);
    if ("text" in value) return String(value.text ?? "");
    if ("error" in value && value.error != null) return String(value.error);
  }
  return "";
}

function cellStyle(cell: ExcelJS.Cell): CellStyle {
  const font = cell.font;
  const alignment = cell.alignment;
  const fill = cell.fill;
  let background: string | undefined;
  if (fill?.type === "pattern" && fill.pattern !== "none") {
    background = cssColor(fill.fgColor as WorkbookColor) ?? cssColor(fill.bgColor as WorkbookColor);
  } else if (fill?.type === "gradient" && fill.stops?.[0]) {
    background = cssColor(fill.stops[0].color as WorkbookColor);
  }
  const color = cssColor(font?.color as WorkbookColor) ?? (background ? textOnFill(background) : undefined);
  const horizontal = alignment?.horizontal;
  const vertical = alignment?.vertical;
  const align = horizontal === "center" || horizontal === "centerContinuous" ? "center" : horizontal === "right" ? "right" : horizontal === "justify" || horizontal === "distributed" ? "justify" : horizontal === "left" ? "left" : undefined;
  const valign = vertical === "top" ? "top" : vertical === "bottom" ? "bottom" : vertical === "middle" ? "middle" : undefined;
  return {
    bold: font?.bold || undefined,
    italic: font?.italic || undefined,
    underline: Boolean(font?.underline && font.underline !== "none") || undefined,
    strike: font?.strike || undefined,
    fontFamily: font?.name || undefined,
    fontSizePt: font?.size || undefined,
    color,
    background,
    align,
    valign,
    wrap: alignment?.wrapText || undefined,
    borderTop: borderCss(cell.border?.top),
    borderRight: borderCss(cell.border?.right),
    borderBottom: borderCss(cell.border?.bottom),
    borderLeft: borderCss(cell.border?.left),
  };
}

interface Span {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

function columnIndex(letters: string): number {
  let col = 0;
  for (const ch of letters.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return col;
}

function parseMerge(range: string): { top: number; left: number; bottom: number; right: number } | null {
  const match = /^\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/i.exec(range);
  if (!match) return null;
  const left = columnIndex(match[1]!);
  const top = Number(match[2]);
  const right = columnIndex(match[3]!);
  const bottom = Number(match[4]);
  if (bottom < top || right < left) return null;
  return { top, left, bottom, right };
}

function sheetFromWorksheet(ws: ExcelJS.Worksheet): SheetGrid {
  let top = 1;
  let left = 1;
  let bottom = 0;
  let right = 0;
  if (ws.actualRowCount > 0 || ws.actualColumnCount > 0) {
    try {
      const dim = ws.dimensions;
      top = Math.max(1, dim.top || 1);
      left = Math.max(1, dim.left || 1);
      bottom = dim.bottom;
      right = dim.right;
    } catch {
      bottom = 0;
      right = 0;
    }
  }

  const merges = (ws.model?.merges ?? []).map(parseMerge).filter((span): span is NonNullable<typeof span> => span !== null);
  for (const merge of merges) {
    bottom = Math.max(bottom, merge.bottom);
    right = Math.max(right, merge.right);
    top = Math.min(top, merge.top);
    left = Math.min(left, merge.left);
  }

  const rowCount = bottom >= top ? bottom - top + 1 : 0;
  const colCount = right >= left ? right - left + 1 : 0;
  const truncatedRows = rowCount > MAX_PREVIEW_ROWS;
  const truncatedCols = colCount > MAX_PREVIEW_COLS;
  const lastRow = top + Math.min(rowCount, MAX_PREVIEW_ROWS) - 1;
  const lastCol = left + Math.min(colCount, MAX_PREVIEW_COLS) - 1;

  const covered = new Set<string>();
  const spans = new Map<string, Span>();
  for (const merge of merges) {
    if (merge.top > lastRow || merge.left > lastCol || merge.bottom < top || merge.right < left) continue;
    const rowSpan = Math.min(merge.bottom, lastRow) - merge.top + 1;
    const colSpan = Math.min(merge.right, lastCol) - merge.left + 1;
    if (merge.top >= top && merge.left >= left) spans.set(`${merge.top},${merge.left}`, { row: merge.top, col: merge.left, rowSpan, colSpan });
    for (let r = merge.top; r <= Math.min(merge.bottom, lastRow); r++) {
      for (let c = merge.left; c <= Math.min(merge.right, lastCol); c++) {
        if (r === merge.top && c === merge.left) continue;
        covered.add(`${r},${c}`);
      }
    }
  }

  const rows: Array<Array<GridCell | null>> = [];
  for (let r = top; r <= lastRow; r++) {
    const line: Array<GridCell | null> = [];
    for (let c = left; c <= lastCol; c++) {
      if (covered.has(`${r},${c}`)) {
        line.push(null);
        continue;
      }
      const cell = ws.getCell(r, c);
      const span = spans.get(`${r},${c}`);
      line.push({
        text: plainValue(cell.value, cell.numFmt),
        rowSpan: span?.rowSpan ?? 1,
        colSpan: span?.colSpan ?? 1,
        style: cellStyle(cell),
      });
    }
    rows.push(line);
  }

  const colWidths: number[] = [];
  for (let c = left; c <= lastCol; c++) colWidths.push(columnWidthPx(ws.getColumn(c).width));

  return {
    name: ws.name || "Sheet",
    rows,
    colWidths,
    rowCount,
    colCount,
    truncatedRows,
    truncatedCols,
  };
}

async function excelModule(): Promise<ExcelModule> {
  const loaded = (await import("exceljs")) as ExcelModule & { default?: ExcelModule };
  return loaded.default ?? loaded;
}

async function readXlsx(data: ArrayBuffer): Promise<SpreadsheetBook> {
  const ExcelJS = await excelModule();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data as never);
  const sheets = workbook.worksheets.filter((sheet) => sheet.state !== "veryHidden").map(sheetFromWorksheet);
  if (sheets.length === 0) throw new Error("This spreadsheet has no sheets to show.");
  return { sheets };
}

async function readXls(data: ArrayBuffer): Promise<SpreadsheetBook> {
  if (looksLikeZip(data)) return readXlsx(data);
  const { readXls: parseXls, CellError } = await import("xls-reader");
  let book;
  try {
    book = parseXls(data);
  } catch {
    throw new Error("Couldn't read that spreadsheet.");
  }
  const sheets = book.sheets
    .filter((sheet) => sheet.visibility !== "very-hidden")
    .map((sheet) =>
      gridFromRows(
        sheet.name || "Sheet",
        sheet.rows.map((row) =>
          row.map((cell) => {
            if (cell == null) return "";
            if (cell instanceof Date) return formatDateValue(cell);
            if (cell instanceof CellError) return cell.toString();
            if (typeof cell === "boolean") return cell ? "TRUE" : "FALSE";
            return String(cell);
          }),
        ),
      ),
    );
  if (sheets.length === 0) throw new Error("This spreadsheet has no sheets to show.");
  return { sheets };
}

function readCsv(data: ArrayBuffer, fileName: string): SpreadsheetBook {
  const text = new TextDecoder("utf-8").decode(data);
  const title = fileName.replace(/\.[^.]+$/, "") || "Sheet";
  return { sheets: [gridFromRows(title, parseCsv(text))] };
}

/** Reads `.xlsx`, legacy `.xls`, or `.csv` into a grid the preview can draw. */
export async function loadSpreadsheet(data: ArrayBuffer, fileName: string): Promise<SpreadsheetBook> {
  const name = fileName.toLowerCase();
  if (name.endsWith(".csv")) return readCsv(data, fileName);
  if (name.endsWith(".xls")) return readXls(data);
  return readXlsx(data);
}
