export interface RevisionLine {
  left: string;
  right: string;
  changed: boolean;
}

/** Pair two revision texts line by line so a side-by-side view can mark what changed. */
export function pairRevisionLines(left: string, right: string): RevisionLine[] {
  const a = left.replace(/\r\n/g, "\n").split("\n");
  const b = right.replace(/\r\n/g, "\n").split("\n");
  const count = Math.max(a.length, b.length);
  const rows: RevisionLine[] = [];
  for (let i = 0; i < count; i++) {
    const leftLine = a[i] ?? "";
    const rightLine = b[i] ?? "";
    rows.push({ left: leftLine, right: rightLine, changed: leftLine !== rightLine });
  }
  return rows;
}
