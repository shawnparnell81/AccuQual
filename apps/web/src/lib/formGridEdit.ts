/**
 * Editing helpers for a grid form: insert and delete rows and columns, toggle styles, set borders.
 * Every function returns a new sheet and leaves the one it was given alone.
 */
import { addressOf, blankCell, MAX_GRID_COLS, MAX_GRID_ROWS, type FormCell, type FormSheet } from "./formGrid";
import { rewriteFormula, type GridChange } from "../../../../services/api/src/modules/form-builder/formulaEngine";

export interface CellBox {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

type Axis = (start: number, span: number) => { start: number; span: number } | null;

function cloneSheet(sheet: FormSheet): FormSheet {
  return JSON.parse(JSON.stringify(sheet)) as FormSheet;
}

/** A merge that the new rows land inside grows. One that starts at or after them moves down. */
const insertAxis =
  (at: number, count: number): Axis =>
  (start, span) => {
    if (at <= start) return { start: start + count, span };
    if (at < start + span) return { start, span: span + count };
    return { start, span };
  };

/**
 * Rows from..to are removed. A merge that loses some of its rows keeps the rest. When the merge's own first row is
 * removed, its content moves to the first row that is left. A merge that loses every row goes away.
 */
const deleteAxis =
  (from: number, to: number): Axis =>
  (start, span) => {
    const count = to - from + 1;
    const end = start + span - 1;
    const lost = Math.max(0, Math.min(end, to) - Math.max(start, from) + 1);
    const left = span - lost;
    if (left <= 0) return null;
    const first = start < from ? start : Math.max(start, to + 1);
    return { start: first < from ? first : first - count, span: left };
  };

const keep: Axis = (start, span) => ({ start, span });

function rebuild(sheet: FormSheet, rowAxis: Axis, colAxis: Axis, widths: number[], heights: number[]): FormSheet {
  const rows = heights.length;
  const cols = widths.length;
  const cells: Array<Array<FormCell | null | undefined>> = Array.from({ length: rows }, () => Array<FormCell | null | undefined>(cols).fill(undefined));
  sheet.cells.forEach((line, row) => {
    line.forEach((cell, col) => {
      if (!cell) return;
      const r = rowAxis(row, cell.rowSpan || 1);
      const c = colAxis(col, cell.colSpan || 1);
      if (!r || !c) return;
      for (let rr = r.start; rr < r.start + r.span; rr += 1) {
        for (let cc = c.start; cc < c.start + c.span; cc += 1) cells[rr]![cc] = null;
      }
      cells[r.start]![c.start] = { ...cell, rowSpan: r.span, colSpan: c.span };
    });
  });
  return {
    ...sheet,
    colWidths: widths,
    rowHeights: heights,
    cells: cells.map((line) => line.map((cell) => (cell === undefined ? blankCell() : cell))),
  };
}

/** Every formula on the sheet follows the cells it points at, as in Excel. A reference to a deleted cell becomes #REF!. */
function rewriteAll(sheet: FormSheet, change: GridChange): FormSheet {
  sheet.cells.forEach((line) => {
    line.forEach((cell) => {
      if (cell?.formula) cell.formula = rewriteFormula(cell.formula, change);
    });
  });
  return sheet;
}

/** Blank rows go in before row `at` (0 is the top, the row count is the bottom). Null when the sheet is full. */
export function insertRows(sheet: FormSheet, at: number, count = 1): FormSheet | null {
  const rows = sheet.rowHeights.length;
  if (at < 0 || at > rows || rows + count > MAX_GRID_ROWS) return null;
  const copy = cloneSheet(sheet);
  const height = copy.rowHeights[Math.min(Math.max(at - 1, 0), rows - 1)] ?? 24;
  const heights = [...copy.rowHeights.slice(0, at), ...Array<number>(count).fill(height), ...copy.rowHeights.slice(at)];
  return rewriteAll(rebuild(copy, insertAxis(at, count), keep, copy.colWidths, heights), { axis: "row", kind: "insert", at: at + 1, count });
}

export function insertColumns(sheet: FormSheet, at: number, count = 1): FormSheet | null {
  const cols = sheet.colWidths.length;
  if (at < 0 || at > cols || cols + count > MAX_GRID_COLS) return null;
  const copy = cloneSheet(sheet);
  const width = copy.colWidths[Math.min(Math.max(at - 1, 0), cols - 1)] ?? 110;
  const widths = [...copy.colWidths.slice(0, at), ...Array<number>(count).fill(width), ...copy.colWidths.slice(at)];
  return rewriteAll(rebuild(copy, keep, insertAxis(at, count), widths, copy.rowHeights), { axis: "col", kind: "insert", at: at + 1, count });
}

/** Rows from..to (0-based, inclusive) are removed. Null when that would leave no rows. */
export function deleteRows(sheet: FormSheet, from: number, to: number): FormSheet | null {
  const rows = sheet.rowHeights.length;
  if (from < 0 || to >= rows || from > to || to - from + 1 >= rows) return null;
  const copy = cloneSheet(sheet);
  const heights = copy.rowHeights.filter((_, index) => index < from || index > to);
  return rewriteAll(rebuild(copy, deleteAxis(from, to), keep, copy.colWidths, heights), { axis: "row", kind: "delete", from: from + 1, to: to + 1 });
}

export function deleteColumns(sheet: FormSheet, from: number, to: number): FormSheet | null {
  const cols = sheet.colWidths.length;
  if (from < 0 || to >= cols || from > to || to - from + 1 >= cols) return null;
  const copy = cloneSheet(sheet);
  const widths = copy.colWidths.filter((_, index) => index < from || index > to);
  return rewriteAll(rebuild(copy, keep, deleteAxis(from, to), widths, copy.rowHeights), { axis: "col", kind: "delete", from: from + 1, to: to + 1 });
}

function columnNumber(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

const CELL_REF = /(?<![A-Za-z0-9_.!])\$?([A-Z]{1,3})\$?(\d+)(?![\dA-Za-z(])/g;
const RANGE_REF = /(?<![A-Za-z0-9_.!])\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+)(?![\dA-Za-z(])/g;

/**
 * Cells whose formula mentions a row or column that is about to be deleted (0-based, inclusive).
 * Their references to the deleted cells turn into #REF!, so the editor names them.
 */
export function formulasReferencing(sheet: FormSheet, axis: "row" | "col", from: number, to: number): string[] {
  const hits: string[] = [];
  const first = from + 1;
  const last = to + 1;
  const overlaps = (a: number, b: number) => Math.max(Math.min(a, b), first) <= Math.min(Math.max(a, b), last);
  sheet.cells.forEach((line, row) => {
    line.forEach((cell, col) => {
      if (!cell?.formula) return;
      if (axis === "row" ? row >= from && row <= to : col >= from && col <= to) return;
      let found = false;
      const rest = cell.formula.toUpperCase().replace(RANGE_REF, (_all, c1: string, r1: string, c2: string, r2: string) => {
        if (axis === "row" ? overlaps(Number(r1), Number(r2)) : overlaps(columnNumber(c1), columnNumber(c2))) found = true;
        return " ";
      });
      for (const match of rest.matchAll(CELL_REF)) {
        const index = axis === "row" ? Number(match[2]) : columnNumber(match[1]!);
        if (index >= first && index <= last) found = true;
      }
      if (found) hits.push(addressOf(col + 1, row + 1));
    });
  });
  return hits;
}

export type BorderLine = "thin" | "medium" | "thick" | "dashed" | "double";
export type BorderTarget = "top" | "right" | "bottom" | "left" | "outside" | "all" | "none";
export type StyleFlag = "bold" | "italic" | "underline" | "wrap";

const BORDER_WIDTH: Record<BorderLine, string> = {
  thin: "1px solid",
  medium: "2px solid",
  thick: "3px solid",
  dashed: "1px dashed",
  double: "3px double",
};

export function borderValue(line: BorderLine, color: string): string {
  return `${BORDER_WIDTH[line]} ${color}`;
}

function eachCell(sheet: FormSheet, box: CellBox, visit: (cell: FormCell, row: number, col: number) => void) {
  for (let row = box.r1; row <= box.r2; row += 1) {
    for (let col = box.c1; col <= box.c2; col += 1) {
      const cell = sheet.cells[row]?.[col];
      if (cell) visit(cell, row, col);
    }
  }
}

/** True when every selected cell has the flag, so a toolbar button can show as pressed. */
export function styleFlagOn(sheet: FormSheet, box: CellBox, flag: StyleFlag): boolean {
  let any = false;
  let all = true;
  eachCell(sheet, box, (cell) => {
    any = true;
    if (!cell.style[flag]) all = false;
  });
  return any && all;
}

/** Bold, italic, underline and wrap switch off when every selected cell already has them, and on otherwise. */
export function toggleStyleFlag(sheet: FormSheet, box: CellBox, flag: StyleFlag): FormSheet {
  const turnOff = styleFlagOn(sheet, box, flag);
  const copy = cloneSheet(sheet);
  eachCell(copy, box, (cell) => {
    if (turnOff) delete cell.style[flag];
    else cell.style[flag] = true;
  });
  return copy;
}

/** Sets border sides on the selected cells. A merged cell counts as touching every edge it reaches. */
export function applyBorders(sheet: FormSheet, box: CellBox, target: BorderTarget, line: BorderLine, color: string): FormSheet {
  const copy = cloneSheet(sheet);
  const value = borderValue(line, color);
  eachCell(copy, box, (cell, row, col) => {
    if (target === "none") {
      delete cell.style.borderTop;
      delete cell.style.borderRight;
      delete cell.style.borderBottom;
      delete cell.style.borderLeft;
      return;
    }
    const touches = {
      top: row === box.r1,
      left: col === box.c1,
      bottom: row + (cell.rowSpan || 1) - 1 >= box.r2,
      right: col + (cell.colSpan || 1) - 1 >= box.c2,
    };
    const wants = (side: "top" | "right" | "bottom" | "left") => target === "all" || target === side || (target === "outside" && touches[side]);
    if (wants("top") && (target === "all" || touches.top)) cell.style.borderTop = value;
    if (wants("right") && (target === "all" || touches.right)) cell.style.borderRight = value;
    if (wants("bottom") && (target === "all" || touches.bottom)) cell.style.borderBottom = value;
    if (wants("left") && (target === "all" || touches.left)) cell.style.borderLeft = value;
  });
  return copy;
}
