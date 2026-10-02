/** Tab-separated grid from a spreadsheet paste. A trailing newline does not add an empty row. */
export function parseClipboardGrid(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const source = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  if (!source) return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
      continue;
    }
    if (ch === "\t") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

export function isMultiCellPaste(grid: string[][]): boolean {
  if (grid.length === 0) return false;
  if (grid.length > 1) return true;
  return (grid[0]?.length ?? 0) > 1;
}

/** Turn a recognizable date into YYYY-MM-DD. Anything else is left as typed. */
export function normalizePastedCell(value: string, hint: "date" | "text"): string {
  if (hint !== "date") return value;
  const trimmed = value.trim();
  if (!trimmed) return "";
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (iso?.[1] && iso[2] && iso[3]) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(trimmed);
  const monthRaw = us?.[1];
  const dayRaw = us?.[2];
  const yearRaw = us?.[3];
  if (!monthRaw || !dayRaw || !yearRaw) return value;
  let year = yearRaw;
  if (year.length === 2) year = Number(year) >= 70 ? `19${year}` : `20${year}`;
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (month < 1 || month > 12 || day < 1 || day > 31) return value;
  return `${year}-${monthRaw.padStart(2, "0")}-${dayRaw.padStart(2, "0")}`;
}

export function pasteIntoMatrix(matrix: string[][], startRow: number, startCol: number, pasted: string[][]): string[][] {
  const next = matrix.map((row) => row.slice());
  for (let r = 0; r < pasted.length; r++) {
    const source = pasted[r];
    if (!source) continue;
    for (let c = 0; c < source.length; c++) {
      const row = next[startRow + r];
      if (!row || startCol + c >= row.length) continue;
      row[startCol + c] = source[c] ?? "";
    }
  }
  return next;
}

function tsvCell(value: string): string {
  if (/[\t\n"]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Copy a rectangular selection. Unselected holes inside the rectangle stay empty. */
export function selectionToTsv(values: string[][], selected: boolean[][]): string {
  let r1 = Number.POSITIVE_INFINITY;
  let c1 = Number.POSITIVE_INFINITY;
  let r2 = -1;
  let c2 = -1;
  for (let r = 0; r < selected.length; r++) {
    for (let c = 0; c < (selected[r]?.length ?? 0); c++) {
      if (!selected[r]?.[c]) continue;
      r1 = Math.min(r1, r);
      c1 = Math.min(c1, c);
      r2 = Math.max(r2, r);
      c2 = Math.max(c2, c);
    }
  }
  if (r2 < 0) return "";
  const lines: string[] = [];
  for (let r = r1; r <= r2; r++) {
    const cells: string[] = [];
    for (let c = c1; c <= c2; c++) {
      cells.push(tsvCell(selected[r]?.[c] ? (values[r]?.[c] ?? "") : ""));
    }
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}
