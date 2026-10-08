import { columnIndex, columnLetter, parseAddr } from "./controlledListMath";

export type GridMove = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/** Next cell address, or null at the edge of the sheet. */
export function moveAddr(addr: string, key: GridMove, bounds: { minRow: number; maxRow: number; maxCol: number }): string | null {
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

/** Rows drawn above the column titles. They fit the page width so names are not clipped. */
export function headerBandEnd(dataStart: number): number {
  return Math.max(1, dataStart - 1);
}
