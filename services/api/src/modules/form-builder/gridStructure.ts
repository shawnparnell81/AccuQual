/**
 * Server-side check of a grid form's structure. The shape mirrors GridFormStructure in apps/web/src/lib/formGrid.ts,
 * which stays the source of truth. A problem is reported in plain words with the sheet and cell it is in.
 */
import { AppError } from "../../utils/appError.js";
import { CELL_TYPES, MAX_DECIMALS, MAX_DROPDOWN_OPTIONS } from "./cellInput.js";

export const MAX_SHEETS = 10;
export const MAX_GRID_ROWS = 500;
export const MAX_GRID_COLS = 60;
export const MIN_SIZE = 8;
export const MAX_SIZE = 1000;

const HEX = /^#[0-9a-fA-F]{6}$/;
/**
 * A border is "<width>px <line> <color>". thin, medium and thick are 1px, 2px and 3px solid; dashed and double are
 * their own lines. Dotted lines and currentColor come from spreadsheets already imported and from the older Borders
 * button, so they stay valid.
 */
const BORDER = /^[1-3]px (solid|dashed|double|dotted) (#[0-9a-fA-F]{6}|currentColor)$/;
const BORDER_SIDES = ["borderTop", "borderRight", "borderBottom", "borderLeft"] as const;
const ALIGN = new Set(["left", "center", "right", "justify"]);
const VALIGN = new Set(["top", "middle", "bottom"]);

function columnLetter(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isWholeAtLeast = (value: unknown, least: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= least;

function checkStyle(style: unknown): string | null {
  if (style === undefined) return null;
  if (!isObject(style)) return "the style is not valid.";
  for (const key of ["color", "background"] as const) {
    const value = style[key];
    if (value !== undefined && !(typeof value === "string" && HEX.test(value))) return `the ${key === "color" ? "text color" : "fill color"} must look like #RRGGBB.`;
  }
  for (const side of BORDER_SIDES) {
    const value = style[side];
    if (value !== undefined && !(typeof value === "string" && BORDER.test(value))) {
      return `the ${side.slice(6).toLowerCase()} border must be thin, medium, thick, dashed or double, with a #RRGGBB color.`;
    }
  }
  if (style.align !== undefined && !(typeof style.align === "string" && ALIGN.has(style.align))) return "the horizontal alignment is not valid.";
  if (style.valign !== undefined && !(typeof style.valign === "string" && VALIGN.has(style.valign))) return "the vertical alignment is not valid.";
  return null;
}

function checkCell(cell: Record<string, unknown>): string | null {
  if (typeof cell.value !== "string") return "the value must be text.";
  if (typeof cell.locked !== "boolean") return "locked must be true or false.";
  if (!isWholeAtLeast(cell.rowSpan, 1)) return "the row span must be a whole number of at least 1.";
  if (!isWholeAtLeast(cell.colSpan, 1)) return "the column span must be a whole number of at least 1.";
  if (cell.formula !== undefined && typeof cell.formula !== "string") return "the formula must be text.";
  if (cell.type !== undefined && !(CELL_TYPES as readonly unknown[]).includes(cell.type)) return `the cell type must be one of ${CELL_TYPES.join(", ")}.`;
  if (cell.options !== undefined || cell.type === "dropdown") {
    const options = cell.options;
    if (!Array.isArray(options) || options.length < 1 || options.length > MAX_DROPDOWN_OPTIONS) {
      return `a dropdown needs 1 to ${MAX_DROPDOWN_OPTIONS} options.`;
    }
    if (!options.every((option) => typeof option === "string" && option.trim() !== "")) return "dropdown options cannot be empty.";
  }
  if (cell.decimals !== undefined && !(isWholeAtLeast(cell.decimals, 0) && cell.decimals <= MAX_DECIMALS)) return `decimals must be a whole number from 0 to ${MAX_DECIMALS}.`;
  for (const key of ["min", "max"] as const) {
    const value = cell[key];
    if (value !== undefined && !(typeof value === "number" && Number.isFinite(value))) return `the ${key === "min" ? "minimum" : "maximum"} must be a number.`;
  }
  if (typeof cell.min === "number" && typeof cell.max === "number" && cell.min > cell.max) return "the minimum is more than the maximum.";
  return checkStyle(cell.style);
}

function checkSheet(sheet: unknown): string | null {
  if (!isObject(sheet)) return "is not valid.";
  const { colWidths, rowHeights, cells } = sheet;
  if (!Array.isArray(cells) || cells.length < 1) return "needs at least one row.";
  if (!Array.isArray(colWidths) || !Array.isArray(rowHeights)) return "is missing its column widths or row heights.";
  if (cells.length > MAX_GRID_ROWS) return `has ${cells.length} rows. A sheet can have at most ${MAX_GRID_ROWS}.`;
  if (colWidths.length < 1) return "needs at least one column.";
  if (colWidths.length > MAX_GRID_COLS) return `has ${colWidths.length} columns. A sheet can have at most ${MAX_GRID_COLS}.`;
  if (rowHeights.length !== cells.length) return `has ${cells.length} rows but ${rowHeights.length} row heights.`;
  const widthsOk = (list: unknown[]) => list.every((size) => typeof size === "number" && Number.isFinite(size) && size >= MIN_SIZE && size <= MAX_SIZE);
  if (!widthsOk(colWidths)) return `has a column width outside ${MIN_SIZE} to ${MAX_SIZE}.`;
  if (!widthsOk(rowHeights)) return `has a row height outside ${MIN_SIZE} to ${MAX_SIZE}.`;

  const rows = cells.length;
  const cols = colWidths.length;
  const anchors: Array<{ row: number; col: number; rowSpan: number; colSpan: number }> = [];

  for (let row = 0; row < rows; row += 1) {
    const line = cells[row];
    if (!Array.isArray(line) || line.length !== cols) return `row ${row + 1} has ${Array.isArray(line) ? line.length : 0} cells but the sheet has ${cols} columns.`;
    for (let col = 0; col < cols; col += 1) {
      const cell = line[col];
      if (cell === null) continue;
      const at = `cell ${columnLetter(col)}${row + 1}`;
      if (!isObject(cell)) return `${at} is not valid.`;
      const problem = checkCell(cell);
      if (problem) return `${at}: ${problem}`;
      const rowSpan = cell.rowSpan as number;
      const colSpan = cell.colSpan as number;
      if (row + rowSpan > rows || col + colSpan > cols) return `${at}: the merge goes outside the sheet.`;
      anchors.push({ row, col, rowSpan, colSpan });
    }
  }

  const merges = anchors.filter((anchor) => anchor.rowSpan > 1 || anchor.colSpan > 1);
  const owner: Array<Array<{ row: number; col: number } | null>> = Array.from({ length: rows }, () => Array<{ row: number; col: number } | null>(cols).fill(null));
  for (const { row, col, rowSpan, colSpan } of merges) {
    for (let r = row; r < row + rowSpan; r += 1) {
      for (let c = col; c < col + colSpan; c += 1) {
        const other = owner[r]![c];
        if (other) return `cell ${columnLetter(col)}${row + 1}: the merge overlaps the merge at ${columnLetter(other.col)}${other.row + 1}.`;
        owner[r]![c] = { row, col };
      }
    }
  }
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const owned = owner[r]![c];
      if (owned && (owned.row !== r || owned.col !== c) && (cells[r] as unknown[])[c] !== null) {
        return `cell ${columnLetter(c)}${r + 1} is covered by the merge at ${columnLetter(owned.col)}${owned.row + 1} and must be empty.`;
      }
    }
  }
  return null;
}

/** The first problem in a grid form's structure, in plain words, or null when it is fine. */
export function gridStructureError(structure: unknown): string | null {
  if (!isObject(structure) || !Array.isArray(structure.sheets)) return "The grid has no sheets.";
  const sheets = structure.sheets as unknown[];
  if (sheets.length < 1) return "The grid needs at least one sheet.";
  if (sheets.length > MAX_SHEETS) return `The grid has ${sheets.length} sheets. A form can have at most ${MAX_SHEETS}.`;
  for (let index = 0; index < sheets.length; index += 1) {
    const sheet = sheets[index];
    const name = isObject(sheet) && typeof sheet.name === "string" && sheet.name.trim() ? ` ("${sheet.name.trim()}")` : "";
    const problem = checkSheet(sheet);
    if (problem) {
      const label = `Sheet ${index + 1}${name}`;
      return problem.startsWith("cell ") || problem.startsWith("row ") ? `${label}, ${problem}` : `${label} ${problem}`;
    }
  }
  return null;
}

export function validateGridStructure(structure: unknown): void {
  const problem = gridStructureError(structure);
  if (problem) throw AppError.badRequest(problem);
}
