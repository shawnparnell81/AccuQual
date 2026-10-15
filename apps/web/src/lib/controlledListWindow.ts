/** Which rows of a long Master list grid to build: the ones on screen plus a margin above and below. */
export interface RowWindow {
  from: number;
  to: number;
}

/**
 * rowPx holds each grid row's height in order, starting at sheet row firstRow. scrollTop is how far the top of the
 * grid sits above the top of the screen (negative while the grid starts lower down the page).
 */
export function rowWindow(rowPx: number[], scrollTop: number, viewHeight: number, firstRow: number, overscan: number): RowWindow {
  const count = rowPx.length;
  if (count === 0) return { from: firstRow, to: firstRow - 1 };
  const top = Math.max(0, scrollTop);
  const bottom = Math.max(top, scrollTop + viewHeight);
  let y = 0;
  let first = count - 1;
  let last = count - 1;
  let seenFirst = false;
  for (let index = 0; index < count; index += 1) {
    const end = y + rowPx[index]!;
    if (!seenFirst && end > top) {
      first = index;
      seenFirst = true;
    }
    if (y >= bottom) {
      last = index - 1;
      break;
    }
    y = end;
  }
  if (!seenFirst) first = count - 1;
  last = Math.max(first, last);
  return { from: firstRow + Math.max(0, first - overscan), to: firstRow + Math.min(count - 1, last + overscan) };
}

export function sameWindow(a: RowWindow, b: RowWindow): boolean {
  return a.from === b.from && a.to === b.to;
}
