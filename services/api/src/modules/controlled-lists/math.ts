/** Excel date and due-date math for the living controlled lists.
 * LST-EQP-001 column I is `=H{row}+(G{row}*30)`: blank cells count as 0, dates are Excel serials.
 * Keep the same rules in apps/web/src/lib/controlledListMath.ts.
 */

export type CellKind = "label" | "input" | "formula" | "rev" | "location";

export interface StoredCell {
  v?: string | number | null;
  f?: string;
  nf?: string;
  kind: CellKind;
  bold?: boolean;
  size?: number;
  align?: string;
  wrap?: boolean;
  comment?: string;
  /** Face when it is not Aptos Narrow. */
  font?: string;
  /** ARGB font color when the cell is not the theme default. */
  color?: string;
}

/** An Excel list dropdown covering a rectangle of cells. */
export interface SheetList {
  c1: string;
  c2: string;
  r1: number;
  r2: number;
  options: string[];
}

/** Status color from the workbook's conditional formatting. */
export interface SheetTone {
  c1: string;
  c2: string;
  r1: number;
  r2: number;
  text: string;
  argb: string;
}

export interface StoredSheet {
  name: string;
  maxRow: number;
  maxCol: number;
  colWidths: number[];
  rowHeights: Record<string, number>;
  merges: string[];
  cells: Record<string, StoredCell>;
  /** Dropdowns. Later lists win when two cover the same cell. */
  lists?: SheetList[];
  /** Conditional fills. Later rules win when two match the same cell. */
  tones?: SheetTone[];
  /** Per-cell border codes, LRTB, each t (thin), m (medium), or - (none). */
  boxes?: Record<string, string>;
}

export type DueTone = "overdue" | "soon";

const EPOCH = Date.UTC(1899, 11, 30);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DUE = /^([A-Z]+)(\d+)\+\(([A-Z]+)(\d+)\*(\d+(?:\.\d+)?)\)$/;

export function columnIndex(letter: string): number {
  let n = 0;
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function columnLetter(index: number): string {
  let n = index;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function parseAddr(addr: string): { col: string; row: number } {
  const match = /^([A-Z]+)(\d+)$/.exec(addr);
  if (!match) return { col: "A", row: 1 };
  return { col: match[1] ?? "A", row: Number(match[2]) };
}

export function cellAddr(col: string, row: number): string {
  return `${col}${row}`;
}

export function excelSerial(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(utc)) return null;
  return Math.round((utc - EPOCH) / 86_400_000);
}

export function serialToIso(serial: number): string {
  return new Date(EPOCH + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
}

export function todaySerial(today = new Date()): number {
  return excelSerial(today.toISOString().slice(0, 10)) ?? 0;
}

function numericValue(sheet: StoredSheet, addr: string): number | null {
  const cell = sheet.cells[addr];
  if (!cell || cell.v == null || cell.v === "") return 0;
  if (typeof cell.v === "number" && Number.isFinite(cell.v)) return cell.v;
  if (typeof cell.v === "string") {
    const serial = excelSerial(cell.v);
    if (serial != null) return serial;
    if (/^-?\d+(\.\d+)?$/.test(cell.v.trim())) return Number(cell.v);
    return null;
  }
  return null;
}

/** Excel serial for a due-date formula. Null when a referenced cell is text Excel cannot add. */
export function formulaSerial(sheet: StoredSheet, formula: string): number | null {
  const match = DUE.exec(formula.replace(/^=/, "").replace(/\s/g, ""));
  if (!match) return null;
  const left = numericValue(sheet, `${match[1]}${match[2]}`);
  const right = numericValue(sheet, `${match[3]}${match[4]}`);
  if (left == null || right == null) return null;
  return left + right * Number(match[5]);
}

/** Yellow within 30 days (including today). Red when the due serial is before today. */
export function dueTone(serial: number, today = new Date()): DueTone | null {
  if (!Number.isFinite(serial)) return null;
  const start = todaySerial(today);
  if (serial < start) return "overdue";
  if (serial <= start + 30) return "soon";
  return null;
}

export function formatIso(iso: string, nf?: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const year = match[1] ?? "";
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (nf === "d-mmm-yy") return `${day}-${MONTHS[month - 1] ?? ""}-${year.slice(2)}`;
  if (nf && (nf.includes("yy") || nf.includes("mm"))) {
    return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}-${year.slice(2)}`;
  }
  return iso;
}

export function formatValue(value: string | number | null | undefined, nf?: string): string {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    if (nf && (nf.includes("yy") || nf.includes("mmm") || nf.includes("mm-dd"))) return formatIso(serialToIso(value), nf);
    if (nf?.includes("$")) {
      const amount = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return value < 0 ? `($${amount})` : `$${amount}`;
    }
    if (Number.isInteger(value)) return String(value);
    return String(value);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatIso(value, nf);
  return value;
}

export function shownCell(sheet: StoredSheet, addr: string, today = new Date()): { text: string; tone: DueTone | null } {
  const cell = sheet.cells[addr];
  if (!cell) return { text: "", tone: null };
  if (cell.f) {
    const serial = formulaSerial(sheet, cell.f);
    if (serial == null) return { text: "#VALUE!", tone: null };
    return { text: formatValue(serial, cell.nf), tone: dueTone(serial, today) };
  }
  return { text: formatValue(cell.v, cell.nf), tone: null };
}

/** Dropdown choices for one cell, or null when the cell is free text. */
export function listOptions(sheet: StoredSheet, addr: string): string[] | null {
  if (!sheet.lists?.length) return null;
  const { col, row } = parseAddr(addr);
  const index = columnIndex(col);
  let found: string[] | null = null;
  for (const list of sheet.lists) {
    if (row < list.r1 || row > list.r2) continue;
    if (index < columnIndex(list.c1) || index > columnIndex(list.c2)) continue;
    found = list.options;
  }
  return found;
}

/** Fill color when a status word matches a conditional format, otherwise null. */
export function toneFill(sheet: StoredSheet, addr: string, text: string): string | null {
  if (!sheet.tones?.length || !text) return null;
  const { col, row } = parseAddr(addr);
  const index = columnIndex(col);
  const lower = text.toLowerCase();
  let color: string | null = null;
  for (const tone of sheet.tones) {
    if (row < tone.r1 || row > tone.r2) continue;
    if (index < columnIndex(tone.c1) || index > columnIndex(tone.c2)) continue;
    if (lower.includes(tone.text.toLowerCase())) color = tone.argb;
  }
  return color;
}

export function textOf(value: string | number | null | undefined): string {
  if (value == null) return "";
  return String(value).trim();
}

function shiftFormula(formula: string, deletedRow: number): string {
  return formula.replace(/(\$?)([A-Z]+)(\$?)(\d+)/g, (all, absCol: string, col: string, absRow: string, rowText: string) => {
    const row = Number(rowText);
    if (absRow === "$" || row <= deletedRow) return all;
    return `${absCol}${col}${absRow}${row - 1}`;
  });
}

function shiftMerge(merge: string, deletedRow: number): string | null {
  const [start, end] = merge.split(":");
  if (!start || !end) return merge;
  const a = parseAddr(start);
  const b = parseAddr(end);
  let r1 = a.row;
  let r2 = b.row;
  if (r1 === deletedRow && r2 === deletedRow) return null;
  if (r1 > deletedRow) r1 -= 1;
  if (r2 > deletedRow) r2 -= 1;
  else if (r2 === deletedRow) r2 -= 1;
  if (r2 < r1) return null;
  return `${a.col}${r1}:${b.col}${r2}`;
}

/** Drop one data row and move everything below it up, the way Excel does. */
export function deleteSheetRow(sheet: StoredSheet, deletedRow: number): StoredSheet {
  const cells: Record<string, StoredCell> = {};
  for (const [addr, cell] of Object.entries(sheet.cells)) {
    const { col, row } = parseAddr(addr);
    if (row === deletedRow) continue;
    const nextRow = row > deletedRow ? row - 1 : row;
    const moved: StoredCell = cell.f ? { ...cell, f: shiftFormula(cell.f, deletedRow) } : { ...cell };
    cells[cellAddr(col, nextRow)] = moved;
  }
  const rowHeights: Record<string, number> = {};
  for (const [key, height] of Object.entries(sheet.rowHeights)) {
    const row = Number(key);
    if (row === deletedRow) continue;
    rowHeights[String(row > deletedRow ? row - 1 : row)] = height;
  }
  const merges = sheet.merges.map((merge) => shiftMerge(merge, deletedRow)).filter((merge): merge is string => Boolean(merge));
  const lists = sheet.lists
    ?.map((list) => {
      const span = shiftMerge(`${list.c1}${list.r1}:${list.c2}${list.r2}`, deletedRow);
      if (!span) return null;
      const [start, end] = span.split(":");
      if (!start || !end) return null;
      const a = parseAddr(start);
      const b = parseAddr(end);
      return { ...list, c1: a.col, r1: a.row, c2: b.col, r2: b.row };
    })
    .filter((list): list is SheetList => Boolean(list));
  const tones = sheet.tones
    ?.map((tone) => {
      const span = shiftMerge(`${tone.c1}${tone.r1}:${tone.c2}${tone.r2}`, deletedRow);
      if (!span) return null;
      const [start, end] = span.split(":");
      if (!start || !end) return null;
      const a = parseAddr(start);
      const b = parseAddr(end);
      return { ...tone, c1: a.col, r1: a.row, c2: b.col, r2: b.row };
    })
    .filter((tone): tone is SheetTone => Boolean(tone));
  const boxes: Record<string, string> = {};
  for (const [addr, box] of Object.entries(sheet.boxes ?? {})) {
    const { col, row } = parseAddr(addr);
    if (row === deletedRow) continue;
    boxes[cellAddr(col, row > deletedRow ? row - 1 : row)] = box;
  }
  return {
    ...sheet,
    maxRow: Math.max(1, sheet.maxRow - 1),
    cells,
    rowHeights,
    merges,
    lists,
    tones,
    boxes: sheet.boxes ? boxes : undefined,
  };
}

/** Give one row the dropdowns used on the rows above it, without widening older ranges. */
export function coverRow(sheet: StoredSheet, row: number): StoredSheet {
  if (!sheet.lists?.length) return sheet;
  const lists = sheet.lists.map((list) => ({ ...list, options: [...list.options] }));
  const added: SheetList[] = [];
  for (let col = 1; col <= sheet.maxCol; col += 1) {
    const letter = columnLetter(col);
    const covered = lists.some((list) => row >= list.r1 && row <= list.r2 && col >= columnIndex(list.c1) && col <= columnIndex(list.c2));
    if (covered) continue;
    let best: SheetList | undefined;
    for (const list of lists) {
      if (col < columnIndex(list.c1) || col > columnIndex(list.c2)) continue;
      if (!best || list.r2 > best.r2) best = list;
    }
    if (!best) continue;
    added.push({ c1: letter, c2: letter, r1: row, r2: row, options: [...best.options] });
  }
  return added.length === 0 ? sheet : { ...sheet, lists: [...lists, ...added] };
}

/** Give a newly appended row the dropdowns used on the rows above it, without widening older ranges. */
export function coverNewRow(sheet: StoredSheet): StoredSheet {
  return coverRow(sheet, sheet.maxRow);
}

function singleRowMerges(sheet: StoredSheet, row: number): string[] {
  return sheet.merges.filter((merge) => {
    const [start, end] = merge.split(":");
    if (!start || !end) return false;
    return parseAddr(start).row === row && parseAddr(end).row === row;
  });
}

/** Append a row. A due-date column receives the same formula shape as the rows above it. */
export function appendSheetRow(sheet: StoredSheet, formula?: { column: string; nf: string; build: (row: number) => string }): StoredSheet {
  const row = sheet.maxRow + 1;
  const template = singleRowMerges(sheet, sheet.maxRow).map((merge) => {
    const [start, end] = merge.split(":");
    if (!start || !end) return merge;
    return `${parseAddr(start).col}${row}:${parseAddr(end).col}${row}`;
  });
  const cells = { ...sheet.cells };
  if (formula) {
    cells[cellAddr(formula.column, row)] = { f: formula.build(row), nf: formula.nf, kind: "formula" };
  }
  return { ...sheet, maxRow: row, cells, merges: [...sheet.merges, ...template] };
}

function rowUsed(sheet: StoredSheet, row: number, columns: string[]): boolean {
  return columns.some((col) => {
    const cell = sheet.cells[cellAddr(col, row)];
    return Boolean(cell && (textOf(cell.v) || cell.f));
  });
}

/** First row after the last data row that already has something in it. */
export function nextDataRow(sheet: StoredSheet, dataStart: number, columns: string[]): number {
  let last = dataStart - 1;
  for (let row = dataStart; row <= sheet.maxRow; row += 1) {
    if (rowUsed(sheet, row, columns)) last = row;
  }
  return last + 1;
}

function shiftFormulaInsert(formula: string, atRow: number): string {
  return formula.replace(/(\$?)([A-Z]+)(\$?)(\d+)/g, (all, absCol: string, col: string, absRow: string, rowText: string) => {
    const row = Number(rowText);
    if (absRow === "$" || row < atRow) return all;
    return `${absCol}${col}${absRow}${row + 1}`;
  });
}

function shiftMergeInsert(merge: string, atRow: number): string {
  const [start, end] = merge.split(":");
  if (!start || !end) return merge;
  const a = parseAddr(start);
  const b = parseAddr(end);
  const r1 = a.row >= atRow ? a.row + 1 : a.row;
  const r2 = b.row >= atRow ? b.row + 1 : b.row;
  return `${a.col}${r1}:${b.col}${r2}`;
}

function shiftSpanInsert<T extends { c1: string; c2: string; r1: number; r2: number }>(span: T, atRow: number): T {
  const next = shiftMergeInsert(`${span.c1}${span.r1}:${span.c2}${span.r2}`, atRow);
  const [start, end] = next.split(":");
  if (!start || !end) return span;
  const a = parseAddr(start);
  const b = parseAddr(end);
  return { ...span, c1: a.col, r1: a.row, c2: b.col, r2: b.row };
}

/** Insert a blank row at `atRow` and move everything at or below it down. Formulas follow the cells. */
export function insertSheetRow(sheet: StoredSheet, atRow: number): StoredSheet {
  const cells: Record<string, StoredCell> = {};
  for (const [addr, cell] of Object.entries(sheet.cells)) {
    const { col, row } = parseAddr(addr);
    const nextRow = row >= atRow ? row + 1 : row;
    const moved: StoredCell = cell.f ? { ...cell, f: shiftFormulaInsert(cell.f, atRow) } : { ...cell };
    cells[cellAddr(col, nextRow)] = moved;
  }
  const rowHeights: Record<string, number> = {};
  for (const [key, height] of Object.entries(sheet.rowHeights)) {
    const row = Number(key);
    rowHeights[String(row >= atRow ? row + 1 : row)] = height;
  }
  const boxes: Record<string, string> = {};
  for (const [addr, box] of Object.entries(sheet.boxes ?? {})) {
    const { col, row } = parseAddr(addr);
    boxes[cellAddr(col, row >= atRow ? row + 1 : row)] = box;
  }
  return {
    ...sheet,
    maxRow: sheet.maxRow + 1,
    cells,
    rowHeights,
    merges: sheet.merges.map((merge) => shiftMergeInsert(merge, atRow)),
    lists: sheet.lists?.map((list) => shiftSpanInsert(list, atRow)),
    tones: sheet.tones?.map((tone) => shiftSpanInsert(tone, atRow)),
    boxes: sheet.boxes ? boxes : undefined,
  };
}

function shiftFormulaCol(formula: string, atCol: number, delta: 1 | -1): string {
  return formula.replace(/(\$?)([A-Z]+)(\$?)(\d+)/g, (all, absCol: string, col: string, absRow: string, rowText: string) => {
    if (absCol === "$") return all;
    const index = columnIndex(col);
    if (delta < 0 && index === atCol) return "#REF!";
    if (index >= atCol) return `${absCol}${columnLetter(index + delta)}${absRow}${rowText}`;
    return all;
  });
}

function mapCol(index: number, atCol: number, delta: 1 | -1): number | null {
  if (delta < 0 && index === atCol) return null;
  if (index > atCol || (delta > 0 && index >= atCol)) return index + delta;
  return index;
}

function shiftMergeCol(merge: string, atCol: number, delta: 1 | -1): string | null {
  const [start, end] = merge.split(":");
  if (!start || !end) return merge;
  const a = parseAddr(start);
  const b = parseAddr(end);
  const c1 = columnIndex(a.col);
  const c2 = columnIndex(b.col);
  if (delta < 0 && c1 === atCol && c2 === atCol) return null;
  let n1 = c1;
  let n2 = c2;
  if (delta > 0) {
    if (c1 >= atCol) n1 = c1 + 1;
    if (c2 >= atCol) n2 = c2 + 1;
  } else {
    if (c1 > atCol) n1 = c1 - 1;
    if (c2 > atCol) n2 = c2 - 1;
    else if (c2 === atCol) n2 = c2 - 1;
    if (n2 < n1) return null;
  }
  return `${columnLetter(n1)}${a.row}:${columnLetter(n2)}${b.row}`;
}

function shiftSpanCol<T extends { c1: string; c2: string; r1: number; r2: number }>(span: T, atCol: number, delta: 1 | -1): T | null {
  const next = shiftMergeCol(`${span.c1}${span.r1}:${span.c2}${span.r2}`, atCol, delta);
  if (!next) return null;
  const [start, end] = next.split(":");
  if (!start || !end) return span;
  const a = parseAddr(start);
  const b = parseAddr(end);
  return { ...span, c1: a.col, r1: a.row, c2: b.col, r2: b.row };
}

function widenTrailingMerges(merges: string[], oldMax: number): string[] {
  const end = columnLetter(oldMax);
  const next = columnLetter(oldMax + 1);
  return merges.map((merge) => {
    const [start, endAddr] = merge.split(":");
    if (!start || !endAddr) return merge;
    const b = parseAddr(endAddr);
    if (b.col !== end) return merge;
    return `${start}:${next}${b.row}`;
  });
}

/** Insert a blank column at `atCol` (1-based). Appending widens merges that already ran to the last column. */
export function insertSheetColumn(sheet: StoredSheet, atCol: number): StoredSheet {
  const appending = atCol === sheet.maxCol + 1;
  const cells: Record<string, StoredCell> = {};
  for (const [addr, cell] of Object.entries(sheet.cells)) {
    const { col, row } = parseAddr(addr);
    const index = columnIndex(col);
    const next = mapCol(index, atCol, 1);
    if (next == null) continue;
    const moved: StoredCell = cell.f ? { ...cell, f: shiftFormulaCol(cell.f, atCol, 1) } : { ...cell };
    cells[cellAddr(columnLetter(next), row)] = moved;
  }
  const colWidths = sheet.colWidths.slice();
  const width = colWidths[Math.min(atCol, colWidths.length) - 1] ?? 14;
  colWidths.splice(Math.max(0, atCol - 1), 0, width);
  const boxes: Record<string, string> = {};
  for (const [addr, box] of Object.entries(sheet.boxes ?? {})) {
    const { col, row } = parseAddr(addr);
    const next = mapCol(columnIndex(col), atCol, 1);
    if (next == null) continue;
    boxes[cellAddr(columnLetter(next), row)] = box;
  }
  let merges = sheet.merges.map((merge) => shiftMergeCol(merge, atCol, 1)).filter((merge): merge is string => Boolean(merge));
  if (appending) merges = widenTrailingMerges(merges, sheet.maxCol);
  return {
    ...sheet,
    maxCol: sheet.maxCol + 1,
    colWidths,
    cells,
    merges,
    lists: sheet.lists?.map((list) => shiftSpanCol(list, atCol, 1)).filter((list): list is SheetList => Boolean(list)),
    tones: sheet.tones?.map((tone) => shiftSpanCol(tone, atCol, 1)).filter((tone): tone is SheetTone => Boolean(tone)),
    boxes: sheet.boxes ? boxes : undefined,
  };
}

/** Remove one column and close the gap. A formula that pointed at it becomes #REF!. */
export function deleteSheetColumn(sheet: StoredSheet, atCol: number): StoredSheet {
  const cells: Record<string, StoredCell> = {};
  for (const [addr, cell] of Object.entries(sheet.cells)) {
    const { col, row } = parseAddr(addr);
    const next = mapCol(columnIndex(col), atCol, -1);
    if (next == null) continue;
    const moved: StoredCell = cell.f ? { ...cell, f: shiftFormulaCol(cell.f, atCol, -1) } : { ...cell };
    cells[cellAddr(columnLetter(next), row)] = moved;
  }
  const colWidths = sheet.colWidths.slice();
  colWidths.splice(atCol - 1, 1);
  const boxes: Record<string, string> = {};
  for (const [addr, box] of Object.entries(sheet.boxes ?? {})) {
    const { col, row } = parseAddr(addr);
    const next = mapCol(columnIndex(col), atCol, -1);
    if (next == null) continue;
    boxes[cellAddr(columnLetter(next), row)] = box;
  }
  return {
    ...sheet,
    maxCol: Math.max(1, sheet.maxCol - 1),
    colWidths,
    cells,
    merges: sheet.merges.map((merge) => shiftMergeCol(merge, atCol, -1)).filter((merge): merge is string => Boolean(merge)),
    lists: sheet.lists?.map((list) => shiftSpanCol(list, atCol, -1)).filter((list): list is SheetList => Boolean(list)),
    tones: sheet.tones?.map((tone) => shiftSpanCol(tone, atCol, -1)).filter((tone): tone is SheetTone => Boolean(tone)),
    boxes: sheet.boxes ? boxes : undefined,
  };
}

export function parseEdited(text: string, nf?: string): string | number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (nf && (nf.includes("yy") || nf.includes("mmm"))) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(trimmed);
    if (match) {
      const year = (match[3] ?? "").length === 2 ? `20${match[3]}` : match[3];
      return `${year}-${String(match[1]).padStart(2, "0")}-${String(match[2]).padStart(2, "0")}`;
    }
    const named = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec(trimmed);
    if (named) {
      const month = MONTHS.findIndex((item) => item.toLowerCase() === (named[2] ?? "").toLowerCase()) + 1;
      if (month > 0) {
        const year = (named[3] ?? "").length === 2 ? `20${named[3]}` : named[3];
        return `${year}-${String(month).padStart(2, "0")}-${String(named[1]).padStart(2, "0")}`;
      }
    }
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}
