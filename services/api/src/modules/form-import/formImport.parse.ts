import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { AppError } from "../../utils/appError.js";
import type { FormImportField, FormImportTemplate } from "./formImport.templates.js";

export const MAX_IMPORT_RECORDS = 500;
export const MAX_IMPORT_COLUMNS = 60;
const MAX_GRID_ROWS = 600;

export interface GridCell {
  text: string;
  bold: boolean;
  filled: boolean;
  fromFormula: boolean;
  rowSpan: number;
  colSpan: number;
  covered: boolean;
}

export interface ParsedGrid {
  sheetName: string;
  /** 1-based spreadsheet row of cells[0]. */
  originRow: number;
  cells: GridCell[][];
  notes: string[];
}

export interface SourceColumn {
  index: number;
  header: string;
  samples: string[];
}

export interface InterpretedImport {
  mode: "rows" | "record";
  notes: string[];
  columns: SourceColumn[];
  records: { rowNumber: number; cells: string[] }[];
  truncated: boolean;
}

const emptyCell = (): GridCell => ({ text: "", bold: false, filled: false, fromFormula: false, rowSpan: 1, colSpan: 1, covered: false });

function columnIndex(letters: string): number {
  let col = 0;
  for (const ch of letters.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return col;
}

function parseMergeRange(range: string): { top: number; left: number; bottom: number; right: number } | null {
  const match = /^\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/i.exec(range);
  if (!match) return null;
  return { left: columnIndex(match[1]!), top: Number(match[2]), right: columnIndex(match[3]!), bottom: Number(match[4]) };
}

function readExcelValue(value: ExcelJS.CellValue): { text: string; fromFormula: boolean } {
  if (value == null) return { text: "", fromFormula: false };
  if (value instanceof Date) return { text: value.toISOString().slice(0, 10), fromFormula: false };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { text: "", fromFormula: false };
    const rounded = Math.round(value * 1e8) / 1e8;
    return { text: String(rounded), fromFormula: false };
  }
  if (typeof value === "boolean") return { text: value ? "TRUE" : "FALSE", fromFormula: false };
  if (typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) {
      const result = (value as { result?: ExcelJS.CellValue }).result;
      return { text: readExcelValue(result ?? null).text, fromFormula: true };
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return { text: value.richText.map((part) => part.text).join("").trim(), fromFormula: false };
    }
    if ("text" in value && value.text != null) return { text: String(value.text).trim(), fromFormula: false };
    if ("result" in value) return { text: readExcelValue(value.result as ExcelJS.CellValue).text, fromFormula: true };
    return { text: "", fromFormula: false };
  }
  return { text: String(value).trim(), fromFormula: false };
}

function looksLikeDateFormat(fmt: string | undefined): boolean {
  if (!fmt) return false;
  const cleaned = fmt.replace(/\[.*?\]/g, "").toLowerCase();
  return cleaned.includes("yy") || (cleaned.includes("d") && cleaned.includes("m"));
}

function excelSerialToIso(serial: number): string {
  const epoch = Date.UTC(1899, 11, 30);
  return new Date(epoch + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
}

function cellFilled(cell: ExcelJS.Cell): boolean {
  const fill = cell.fill;
  if (!fill || fill.type !== "pattern" || fill.pattern === "none") return false;
  return Boolean(fill.fgColor || fill.bgColor);
}

function gridFromWorksheet(ws: ExcelJS.Worksheet): ParsedGrid {
  const notes: string[] = [];
  let top = 1;
  let bottom = ws.actualRowCount || 0;
  let right = ws.actualColumnCount || 0;
  try {
    const dim = ws.dimensions;
    if (dim) {
      top = Math.max(1, dim.top || 1);
      bottom = Math.max(bottom, dim.bottom || 0);
      right = Math.max(right, dim.right || 0);
    }
  } catch {
    // An empty sheet has no dimensions.
  }
  if (bottom < top || right < 1) return { sheetName: ws.name || "Sheet", originRow: 1, cells: [], notes };

  const truncatedRows = bottom - top + 1 > MAX_GRID_ROWS;
  const truncatedCols = right > MAX_IMPORT_COLUMNS;
  bottom = Math.min(bottom, top + MAX_GRID_ROWS - 1);
  right = Math.min(right, MAX_IMPORT_COLUMNS);
  if (truncatedRows) notes.push(`Only the first ${MAX_GRID_ROWS} rows were read.`);
  if (truncatedCols) notes.push(`Only the first ${MAX_IMPORT_COLUMNS} columns were read.`);

  const spans = new Map<string, { rowSpan: number; colSpan: number; anchor: boolean }>();
  let mergeCount = 0;
  for (const range of ws.model?.merges ?? []) {
    const parsed = parseMergeRange(range);
    if (!parsed) continue;
    mergeCount += 1;
    for (let r = parsed.top; r <= parsed.bottom; r++) {
      for (let c = parsed.left; c <= parsed.right; c++) {
        spans.set(`${r}:${c}`, {
          rowSpan: parsed.bottom - parsed.top + 1,
          colSpan: parsed.right - parsed.left + 1,
          anchor: r === parsed.top && c === parsed.left,
        });
      }
    }
  }
  if (mergeCount > 0) notes.push(`Expanded ${mergeCount} merged ${mergeCount === 1 ? "cell" : "cells"}.`);

  const cells: GridCell[][] = [];
  let formulaValues = 0;
  for (let r = top; r <= bottom; r++) {
    const line: GridCell[] = [];
    for (let c = 1; c <= right; c++) {
      const span = spans.get(`${r}:${c}`);
      if (span && !span.anchor) {
        line.push({ ...emptyCell(), covered: true });
        continue;
      }
      const cell = ws.getCell(r, c);
      let read = readExcelValue(cell.value);
      if (!read.fromFormula && typeof cell.value === "number" && looksLikeDateFormat(cell.numFmt)) {
        read = { text: excelSerialToIso(cell.value), fromFormula: false };
      }
      if (read.fromFormula) formulaValues += 1;
      line.push({
        text: read.text,
        bold: Boolean(cell.font?.bold),
        filled: cellFilled(cell),
        fromFormula: read.fromFormula,
        rowSpan: span?.rowSpan ?? 1,
        colSpan: span?.colSpan ?? 1,
        covered: false,
      });
    }
    cells.push(line);
  }
  if (formulaValues > 0) notes.push("Formula cells were read as their calculated values.");
  const trimmed = trimEmptyEdges(cells);
  return { sheetName: ws.name || "Sheet", originRow: top + trimmed.rowTrim, cells: trimmed.cells, notes };
}

function trimEmptyEdges(cells: GridCell[][]): { cells: GridCell[][]; rowTrim: number } {
  let start = 0;
  let end = cells.length;
  while (start < end && cells[start]!.every((cell) => cell.covered || cell.text === "")) start += 1;
  while (end > start && cells[end - 1]!.every((cell) => cell.covered || cell.text === "")) end -= 1;
  let lastCol = 0;
  for (let r = start; r < end; r++) {
    const line = cells[r]!;
    for (let c = line.length - 1; c >= 0; c--) {
      if (!line[c]!.covered && line[c]!.text !== "") {
        lastCol = Math.max(lastCol, c + 1);
        break;
      }
    }
  }
  return { cells: cells.slice(start, end).map((line) => line.slice(0, lastCol)), rowTrim: start };
}

function sheetJsText(value: unknown): { text: string; fromFormula: boolean } {
  if (value == null) return { text: "", fromFormula: false };
  if (value instanceof Date) return { text: value.toISOString().slice(0, 10), fromFormula: false };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { text: "", fromFormula: false };
    const rounded = Math.round(value * 1e8) / 1e8;
    return { text: String(rounded), fromFormula: false };
  }
  if (typeof value === "boolean") return { text: value ? "TRUE" : "FALSE", fromFormula: false };
  return { text: String(value).trim(), fromFormula: false };
}

function gridFromSheetJs(sheetName: string, sheet: XLSX.WorkSheet): ParsedGrid {
  const notes: string[] = [];
  if (!sheet["!ref"]) return { sheetName, originRow: 1, cells: [], notes };
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const top = range.s.r + 1;
  const left = range.s.c + 1;
  let bottom = range.e.r + 1;
  let right = range.e.c + 1;
  if (bottom - top + 1 > MAX_GRID_ROWS) {
    notes.push(`Only the first ${MAX_GRID_ROWS} rows were read.`);
    bottom = top + MAX_GRID_ROWS - 1;
  }
  if (right - left + 1 > MAX_IMPORT_COLUMNS) {
    notes.push(`Only the first ${MAX_IMPORT_COLUMNS} columns were read.`);
    right = left + MAX_IMPORT_COLUMNS - 1;
  }
  const spans = new Map<string, { rowSpan: number; colSpan: number; anchor: boolean }>();
  const merges = (sheet["!merges"] ?? []) as XLSX.Range[];
  if (merges.length > 0) notes.push(`Expanded ${merges.length} merged ${merges.length === 1 ? "cell" : "cells"}.`);
  for (const merge of merges) {
    for (let r = merge.s.r + 1; r <= merge.e.r + 1; r++) {
      for (let c = merge.s.c + 1; c <= merge.e.c + 1; c++) {
        spans.set(`${r}:${c}`, {
          rowSpan: merge.e.r - merge.s.r + 1,
          colSpan: merge.e.c - merge.s.c + 1,
          anchor: r === merge.s.r + 1 && c === merge.s.c + 1,
        });
      }
    }
  }
  const cells: GridCell[][] = [];
  let formulaValues = 0;
  for (let r = top; r <= bottom; r++) {
    const line: GridCell[] = [];
    for (let c = left; c <= right; c++) {
      const span = spans.get(`${r}:${c}`);
      if (span && !span.anchor) {
        line.push({ ...emptyCell(), covered: true });
        continue;
      }
      const addr = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });
      const raw = sheet[addr] as { v?: unknown; w?: string; f?: string; s?: { font?: { bold?: boolean }; fgColor?: { rgb?: string }; patternType?: string } } | undefined;
      let read = sheetJsText(raw?.v);
      if (raw?.f) {
        read = { text: read.text || String(raw.w ?? "").trim(), fromFormula: true };
        formulaValues += 1;
      } else if (!read.text && raw?.w) read = { text: String(raw.w).trim(), fromFormula: false };
      const style = raw?.s;
      line.push({
        text: read.text,
        bold: Boolean(style?.font?.bold),
        filled: Boolean(style?.fgColor?.rgb || (style?.patternType && style.patternType !== "none")),
        fromFormula: read.fromFormula,
        rowSpan: span?.rowSpan ?? 1,
        colSpan: span?.colSpan ?? 1,
        covered: false,
      });
    }
    cells.push(line);
  }
  if (formulaValues > 0) notes.push("Formula cells were read as their calculated values.");
  const trimmed = trimEmptyEdges(cells);
  return { sheetName, originRow: top + trimmed.rowTrim, cells: trimmed.cells, notes };
}

function gridFromObjects(rows: Record<string, unknown>[]): ParsedGrid {
  const headers: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!headers.includes(key)) headers.push(key);
    }
  }
  const headerLine = headers.map((header) => ({ ...emptyCell(), text: header, bold: true }));
  const body = rows.map((row) => headers.map((header) => ({ ...emptyCell(), text: scalarText(row[header]) })));
  return { sheetName: "JSON", originRow: 1, cells: [headerLine, ...body].slice(0, MAX_GRID_ROWS), notes: ["Read a JSON list of records."] };
}

function scalarText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "object") return "";
  return String(value).trim();
}

function gridFromMatrix(matrix: unknown[][]): ParsedGrid {
  const cells = matrix.slice(0, MAX_GRID_ROWS).map((row) => {
    const line = row.slice(0, MAX_IMPORT_COLUMNS).map((value) => ({ ...emptyCell(), text: scalarText(value) }));
    return line;
  });
  return { sheetName: "JSON", originRow: 1, cells, notes: ["Read a JSON table."] };
}

function parseJsonGrid(buffer: Buffer): ParsedGrid {
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    throw AppError.badRequest("That JSON file couldn't be read.");
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return { sheetName: "JSON", originRow: 1, cells: [], notes: [] };
    if (parsed.every((row) => row && typeof row === "object" && !Array.isArray(row))) return gridFromObjects(parsed as Record<string, unknown>[]);
    if (parsed.every((row) => Array.isArray(row))) return gridFromMatrix(parsed as unknown[][]);
  }
  if (parsed && typeof parsed === "object") {
    const record = parsed as { headers?: unknown; rows?: unknown; columns?: unknown };
    if (Array.isArray(record.rows) && record.rows.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
      return gridFromObjects(record.rows as Record<string, unknown>[]);
    }
    if (Array.isArray(record.headers) && Array.isArray(record.rows)) {
      const headers = record.headers.map((header) => scalarText(header));
      const body = (record.rows as unknown[]).map((row) => (Array.isArray(row) ? row.map((value) => scalarText(value)) : []));
      return gridFromMatrix([headers, ...body]);
    }
  }
  throw AppError.badRequest("JSON import expects a list of records, or { headers, rows }.");
}

export async function parseImportFile(buffer: Buffer, fileName: string): Promise<ParsedGrid> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".docx") || lower.endsWith(".doc")) {
    throw AppError.badRequest("Word files are not imported. Upload a CSV, Excel (.xls or .xlsx), or JSON file.");
  }
  if (lower.endsWith(".json")) return parseJsonGrid(buffer);
  try {
    if (lower.endsWith(".xls") && !(buffer.length > 3 && buffer[0] === 0x50 && buffer[1] === 0x4b)) {
      const book = XLSX.read(buffer, { type: "buffer", cellDates: true, cellStyles: true });
      const name = book.SheetNames[0];
      if (!name) throw AppError.badRequest("The file has no data in it.");
      const sheet = book.Sheets[name];
      if (!sheet) throw AppError.badRequest("The file has no data in it.");
      return gridFromSheetJs(name, sheet);
    }
    const workbook = new ExcelJS.Workbook();
    if (lower.endsWith(".csv")) await workbook.csv.read(Readable.from(buffer));
    else await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets.find((ws) => ws.actualRowCount > 0 || ws.actualColumnCount > 0) ?? workbook.worksheets[0];
    if (!sheet) throw AppError.badRequest("The file has no data in it.");
    return gridFromWorksheet(sheet);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw AppError.badRequest("That file couldn't be read. Upload a CSV, Excel (.xls or .xlsx), or JSON file.");
  }
}

interface RowProfile {
  nonEmpty: number;
  numericRatio: number;
  boldRatio: number;
  fillRatio: number;
  title: boolean;
  band: boolean;
}

function anchorText(grid: GridCell[][], row: number, col: number): string {
  const cell = grid[row]?.[col];
  if (!cell) return "";
  if (!cell.covered) return cell.text;
  for (let r = row; r >= Math.max(0, row - 6); r--) {
    for (let c = col; c >= Math.max(0, col - 20); c--) {
      const candidate = grid[r]?.[c];
      if (!candidate || candidate.covered) continue;
      if (r + candidate.rowSpan > row && c + candidate.colSpan > col) return candidate.text;
    }
  }
  return "";
}

function profileRow(grid: GridCell[][], index: number): RowProfile {
  const line = grid[index] ?? [];
  let nonEmpty = 0;
  let numeric = 0;
  let bold = 0;
  let filled = 0;
  let wide = false;
  let longest = 0;
  for (const cell of line) {
    if (cell.covered || cell.text === "") continue;
    nonEmpty += 1;
    longest = Math.max(longest, cell.text.length);
    if (cell.colSpan >= 4) wide = true;
    if (/^-?\d+(\.\d+)?$/.test(cell.text)) numeric += 1;
    if (cell.bold) bold += 1;
    if (cell.filled) filled += 1;
  }
  const title = nonEmpty === 1 && (wide || longest > 36);
  return {
    nonEmpty,
    numericRatio: nonEmpty === 0 ? 0 : numeric / nonEmpty,
    boldRatio: nonEmpty === 0 ? 0 : bold / nonEmpty,
    fillRatio: nonEmpty === 0 ? 0 : filled / nonEmpty,
    title,
    band: nonEmpty >= 2 && (bold / nonEmpty >= 0.45 || filled / nonEmpty >= 0.4),
  };
}

function headerScore(profile: RowProfile): number {
  if (profile.title || profile.nonEmpty < 2) return 0;
  let score = profile.nonEmpty;
  if (profile.band) score += 6;
  if (profile.numericRatio >= 0.5) score -= 5;
  return score;
}

function detectHeaderRows(grid: GridCell[][]): { rows: number[]; notes: string[] } {
  const notes: string[] = [];
  let best = -1;
  let bestScore = 0;
  const limit = Math.min(grid.length, 30);
  for (let i = 0; i < limit; i++) {
    const profile = profileRow(grid, i);
    if (profile.title) continue;
    let score = headerScore(profile);
    if (score <= 0) continue;
    const earlier = grid.slice(0, i).every((_, index) => {
      const prior = profileRow(grid, index);
      return prior.nonEmpty === 0 || prior.title;
    });
    if (earlier) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) return { rows: [], notes };
  const rows = [best];
  const neighbors = [best - 1, best + 1].filter((index) => index >= 0 && index < grid.length);
  const band = neighbors
    .map((index) => ({ index, profile: profileRow(grid, index) }))
    .filter((item) => item.profile.band && !item.profile.title && headerScore(item.profile) >= 2)
    .sort((a, b) => headerScore(b.profile) - headerScore(a.profile))[0];
  if (band) rows.push(band.index);
  rows.sort((a, b) => a - b);
  const titleRows = rows[0]! > 0 ? grid.slice(0, rows[0]!).filter((_, index) => profileRow(grid, index).nonEmpty > 0).length : 0;
  if (titleRows > 0) notes.push(`Skipped ${titleRows} title ${titleRows === 1 ? "row" : "rows"} above the header.`);
  if (rows.length > 1) notes.push("Joined a multi-row header.");
  notes.push(`Header is spreadsheet row ${rows.map((index) => index).join(" and ")}.`);
  return { rows, notes };
}

function tableFromGrid(grid: ParsedGrid): InterpretedImport {
  const notes = [...grid.notes];
  const detected = detectHeaderRows(grid.cells);
  notes.push(...detected.notes.map((note) => (note.startsWith("Header is") ? "" : note)).filter(Boolean));
  if (detected.rows.length === 0) {
    return { mode: "rows", notes: [...notes, "No header row was found."], columns: [], records: [], truncated: false };
  }
  const headerRows = detected.rows;
  const width = grid.cells[headerRows[0]!]!.length;
  const dataStart = headerRows[headerRows.length - 1]! + 1;
  const used: number[] = [];
  for (let c = 0; c < width; c++) {
    const header = headerRows
      .map((row) => anchorText(grid.cells, row, c).trim())
      .filter((part, index, all) => part !== "" && all.indexOf(part) === index)
      .join(" / ");
    let hasData = header !== "";
    if (!hasData) {
      for (let r = dataStart; r < grid.cells.length; r++) {
        const cell = grid.cells[r]![c];
        if (cell && !cell.covered && cell.text !== "") {
          hasData = true;
          break;
        }
      }
    }
    if (hasData) used.push(c);
  }
  const columns: SourceColumn[] = used.map((col, index) => {
    const header = headerRows
      .map((row) => anchorText(grid.cells, row, col).trim())
      .filter((part, partIndex, all) => part !== "" && all.indexOf(part) === partIndex)
      .join(" / ");
    return { index, header: header || `Column ${index + 1}`, samples: [] };
  });
  const records: InterpretedImport["records"] = [];
  for (let r = dataStart; r < grid.cells.length; r++) {
    const cells = used.map((col) => {
      const cell = grid.cells[r]![col];
      if (!cell || cell.covered) return "";
      return cell.text;
    });
    if (cells.every((cell) => cell === "")) continue;
    records.push({ rowNumber: grid.originRow + r, cells });
    if (records.length >= MAX_IMPORT_RECORDS) break;
  }
  for (const column of columns) {
    column.samples = records.map((record) => record.cells[column.index] ?? "").filter((value) => value !== "").slice(0, 3);
  }
  const headerNote = `Header is spreadsheet row ${headerRows.map((index) => grid.originRow + index).join(" and ")}.`;
  notes.push(headerNote);
  const truncated = records.length >= MAX_IMPORT_RECORDS && dataStart + records.length < grid.cells.length;
  if (truncated) notes.push(`Only the first ${MAX_IMPORT_RECORDS} data rows are imported.`);
  return { mode: "rows", notes, columns, records, truncated };
}

export function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/µm/g, "um")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type MeasureRole = "criteria" | "nominal" | "tolerance" | "sample1" | "sample2";

function measureRole(text: string): MeasureRole | null {
  const label = normalizeLabel(text);
  if (label === "criteria" || label === "criterion") return "criteria";
  if (label === "nominal" || label === "nom") return "nominal";
  if (label === "tol" || label.includes("toler") || label.includes("tolor")) return "tolerance";
  if (label === "sample 1" || label === "sample1") return "sample1";
  if (label === "sample 2" || label === "sample2") return "sample2";
  return null;
}

const ROLE_LABEL: Record<Exclude<MeasureRole, "criteria">, string> = {
  nominal: "Nominal",
  tolerance: "Tolerance",
  sample1: "Sample 1",
  sample2: "Sample 2",
};

function isSectionRow(line: GridCell[]): boolean {
  const texts = line.filter((cell) => !cell.covered && cell.text !== "");
  if (texts.length !== 1) return false;
  const text = texts[0]!.text.trim();
  return /^\d+\.0\b/.test(text) || texts[0]!.colSpan >= 4 || text.length > 40;
}

function sheetRecord(grid: ParsedGrid, fields: FormImportField[]): InterpretedImport | null {
  const pairs: { header: string; value: string }[] = [];
  const consumed = new Set<number>();
  for (let r = 0; r < grid.cells.length; r++) {
    const roles = new Map<number, MeasureRole>();
    grid.cells[r]!.forEach((cell, col) => {
      if (cell.covered) return;
      const role = measureRole(cell.text);
      if (role) roles.set(col, role);
    });
    const named = new Set(roles.values());
    if (named.size < 3) continue;
    consumed.add(r);
    for (let d = r + 1; d < grid.cells.length; d++) {
      const line = grid.cells[d]!;
      if (line.every((cell) => cell.covered || cell.text === "")) break;
      if (isSectionRow(line)) break;
      const nextRoles = line.filter((cell) => !cell.covered && measureRole(cell.text)).length;
      if (nextRoles >= 3) break;
      const criterionCell = line.find((cell) => !cell.covered && cell.text !== "");
      const criterion = criterionCell?.text.trim() ?? "";
      if (!criterion || measureRole(criterion)) continue;
      if (/overall disposition|^notes\b/i.test(criterion)) break;
      consumed.add(d);
      for (const [col, role] of roles) {
        if (role === "criteria") continue;
        const cell = line[col];
        if (!cell || cell.covered || cell.text === "") continue;
        pairs.push({ header: `${criterion} / ${ROLE_LABEL[role]}`, value: cell.text });
      }
    }
  }

  const fieldNames = fields.flatMap((field) => [field.label, ...field.aliases]).map(normalizeLabel);
  const labelScore = (text: string) => {
    const label = normalizeLabel(text.replace(/:$/, ""));
    if (!label) return 0;
    return fieldNames.includes(label) ? 1 : 0;
  };

  for (let r = 0; r < grid.cells.length; r++) {
    if (consumed.has(r)) continue;
    const line = grid.cells[r]!;
    const first = line.find((cell) => !cell.covered && cell.text !== "");
    const firstText = first?.text.trim() ?? "";
    if (/overall disposition/i.test(firstText)) {
      consumed.add(r);
      const base = firstText.replace(/:$/, "");
      for (let c = 1; c < line.length; c++) {
        const word = normalizeLabel(line[c]!.covered ? anchorText(grid.cells, r, c) : line[c]!.text);
        if (word !== "pass" && word !== "fail" && word !== "conditional pass") continue;
        const box = line[c - 1];
        if (!box || box.covered) continue;
        if (box.text === "") continue;
        pairs.push({ header: `${base} / ${word === "conditional pass" ? "Conditional Pass" : word[0]!.toUpperCase() + word.slice(1)}`, value: box.text });
      }
      continue;
    }
    for (let c = 0; c < line.length; c++) {
      const cell = line[c]!;
      if (cell.covered || cell.text === "") continue;
      const raw = cell.text.trim();
      const labeled = raw.endsWith(":") || labelScore(raw) >= 1;
      if (!labeled) continue;
      let value = "";
      for (let n = c + 1; n < line.length; n++) {
        const next = line[n]!;
        if (next.covered || next.text === "") continue;
        if (next.text.trim().endsWith(":") || labelScore(next.text) >= 1) break;
        value = next.text;
        break;
      }
      if (!value) continue;
      pairs.push({ header: raw.replace(/:$/, "").trim(), value });
    }
  }

  if (pairs.length < 2) return null;
  const columns: SourceColumn[] = [];
  const values: string[] = [];
  for (const pair of pairs) {
    const existing = columns.find((column) => normalizeLabel(column.header) === normalizeLabel(pair.header));
    if (existing) {
      if (!values[existing.index]) values[existing.index] = pair.value;
      continue;
    }
    const index = columns.length;
    columns.push({ index, header: pair.header, samples: [pair.value] });
    values[index] = pair.value;
  }
  return {
    mode: "record",
    notes: [...grid.notes, "Read this as one filled form: labels beside values, and measurement grids under their headers."],
    columns,
    records: [{ rowNumber: grid.originRow, cells: values }],
    truncated: false,
  };
}

function strongColumnMatches(columns: SourceColumn[], fields: FormImportField[]): number {
  const names = fields.flatMap((field) => [field.label, field.key, ...field.aliases].map(normalizeLabel));
  let hits = 0;
  for (const column of columns) {
    const header = normalizeLabel(column.header);
    if (header && names.includes(header)) hits += 1;
  }
  return hits;
}

/** Turns a parsed grid into columns and records for the selected template. */
export function interpretGrid(grid: ParsedGrid, template: Pick<FormImportTemplate, "shape" | "fields">): InterpretedImport {
  if (grid.cells.length === 0) {
    return { mode: template.shape === "sheet" ? "record" : "rows", notes: [...grid.notes, "The file has no data in it."], columns: [], records: [], truncated: false };
  }
  const table = tableFromGrid(grid);
  const exact = strongColumnMatches(table.columns, template.fields);
  if (template.shape === "table" || (exact >= 2 && table.records.length >= 1)) {
    return { ...table, notes: [...table.notes, "Read this as a table of rows."] };
  }
  const sheet = sheetRecord(grid, template.fields);
  if (sheet && sheet.records[0] && sheet.records[0].cells.some((value) => value !== "")) return sheet;
  return { ...table, notes: [...table.notes, "Read this as a table of rows."] };
}
