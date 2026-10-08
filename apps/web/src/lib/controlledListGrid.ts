import { columnIndex, columnLetter, parseAddr } from "./controlledListMath";

export type GridMove = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/** A way of leaving the cell that must write the draft and flush it. */
export type EditGesture = "Enter" | "Tab" | "ShiftTab" | "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "blur" | "click";

export interface GridBounds {
  minRow: number;
  maxRow: number;
  maxCol: number;
}

/** Next cell address, or null at the edge of the sheet. */
export function moveAddr(addr: string, key: GridMove, bounds: GridBounds): string | null {
  const { col, row } = parseAddr(addr);
  let column = columnIndex(col);
  let line = row;
  if (key === "ArrowUp") line -= 1;
  if (key === "ArrowDown") line += 1;
  if (key === "ArrowLeft") column -= 1;
  if (key === "ArrowRight") column += 1;
  if (line < bounds.minRow || line > bounds.maxRow || column < 1 || column > bounds.maxCol) return null;
  return `${columnLetter(column)}${line}`;
}

/** Tab walks across the row and wraps. Shift+Tab walks backward. */
export function moveTab(addr: string, shift: boolean, bounds: GridBounds): string | null {
  const straight = moveAddr(addr, shift ? "ArrowLeft" : "ArrowRight", bounds);
  if (straight) return straight;
  const { col, row } = parseAddr(addr);
  const column = columnIndex(col);
  if (!shift && column >= bounds.maxCol && row < bounds.maxRow) return `A${row + 1}`;
  if (shift && column <= 1 && row > bounds.minRow) return `${columnLetter(bounds.maxCol)}${row - 1}`;
  return null;
}

export type KeyGesture = "Enter" | "Tab" | "ShiftTab" | GridMove;

export function gestureFromKey(key: string, shift: boolean): KeyGesture | null {
  if (key === "Enter") return "Enter";
  if (key === "Tab") return shift ? "ShiftTab" : "Tab";
  if (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight") return key;
  return null;
}

/** Enter, Tab, Shift+Tab, arrows, blur, and clicking another cell all write the draft. */
export function gestureSavesEdit(gesture: EditGesture): boolean {
  switch (gesture) {
    case "Enter":
    case "Tab":
    case "ShiftTab":
    case "ArrowUp":
    case "ArrowDown":
    case "ArrowLeft":
    case "ArrowRight":
    case "blur":
    case "click":
      return true;
    default:
      return false;
  }
}

export interface GridSnapshot {
  cells: Record<string, string | number | null>;
}

export interface GridEditorState {
  saved: GridSnapshot;
  /** Keystrokes already queued, not yet flushed. */
  pending: Record<string, string | number | null>;
  /** A value that exists only in the field until a leave gesture. */
  draft: { addr: string; value: string | number | null } | null;
}

/**
 * A leave gesture folds the draft and any queued keystrokes into the saved sheet.
 * Reload reads that sheet. Leaving them uncommitted keeps the previous saved value.
 */
export function commitAndReload(state: GridEditorState, gesture: EditGesture): GridSnapshot {
  if (!gestureSavesEdit(gesture)) return { cells: { ...state.saved.cells } };
  const pending = { ...state.pending };
  if (state.draft) pending[state.draft.addr] = state.draft.value;
  return { cells: { ...state.saved.cells, ...pending } };
}

/** Rows drawn above the column titles. They fit the page width so names are not clipped. */
export function headerBandEnd(dataStart: number): number {
  return Math.max(1, dataStart - 1);
}

export interface PlacedCell {
  addr: string;
  col: number;
  row: number;
  cols: number;
  rows: number;
}

function mergeSpan(merges: string[]): Map<string, { cols: number; rows: number }> {
  const origins = new Map<string, { cols: number; rows: number }>();
  for (const merge of merges) {
    const [start, end] = merge.split(":");
    if (!start || !end) continue;
    const a = parseAddr(start);
    const b = parseAddr(end);
    origins.set(start, {
      cols: Math.max(1, columnIndex(b.col) - columnIndex(a.col) + 1),
      rows: Math.max(1, b.row - a.row + 1),
    });
  }
  return origins;
}

function coveredByMerge(merges: string[]): Set<string> {
  const covered = new Set<string>();
  for (const merge of merges) {
    const [start, end] = merge.split(":");
    if (!start || !end) continue;
    const a = parseAddr(start);
    const b = parseAddr(end);
    const c1 = columnIndex(a.col);
    const c2 = columnIndex(b.col);
    for (let row = a.row; row <= b.row; row += 1) {
      for (let col = c1; col <= c2; col += 1) {
        const addr = `${columnLetter(col)}${row}`;
        if (addr !== start) covered.add(addr);
      }
    }
  }
  return covered;
}

/** Visible cells with their column spans. Covered merge cells are omitted so a span stays in its columns. */
export function placedCells(merges: string[], maxCol: number, fromRow: number, toRow: number): PlacedCell[] {
  const origins = mergeSpan(merges);
  const covered = coveredByMerge(merges);
  const cells: PlacedCell[] = [];
  for (let row = fromRow; row <= toRow; row += 1) {
    for (let col = 1; col <= maxCol; col += 1) {
      const addr = `${columnLetter(col)}${row}`;
      if (covered.has(addr)) continue;
      const span = origins.get(addr);
      cells.push({
        addr,
        col,
        row,
        cols: span?.cols ?? 1,
        rows: Math.min(span?.rows ?? 1, toRow - row + 1),
      });
    }
  }
  return cells;
}
