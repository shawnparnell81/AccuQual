import rawLists from "./seeds/lists.json" with { type: "json" };
import devLog from "./seeds/lst-dev-001.json" with { type: "json" };
import auditSchedule from "./seeds/lst-gen-002.json" with { type: "json" };
import engLog from "./seeds/lst-eng-001.json" with { type: "json" };
import ncrLog from "./seeds/lst-ncr-001.json" with { type: "json" };
import { bumpRevision } from "../form-builder/revision.js";
import {
  appendSheetRow,
  cellAddr,
  columnIndex,
  columnLetter,
  coverNewRow,
  coverRow,
  deleteSheetColumn,
  deleteSheetRow,
  insertSheetColumn,
  insertSheetRow,
  nextDataRow,
  parseAddr,
  textOf,
  type StoredCell,
  type StoredSheet,
} from "./math.js";

export type { StoredCell, StoredSheet } from "./math.js";

export const LIST_KEYS = ["lst-eqp-001", "lst-gen-001", "lst-gen-002", "lst-gen-003", "lst-dev-001", "lst-ncr-001", "lst-eng-001"] as const;
export type ListKey = (typeof LIST_KEYS)[number];

export const OMITTED_DOCUMENT_IDS = new Set(["FRM-TST-001", "FRM-TST-002"]);

export const LIVING_LIST_PATHS = [
  "/documents/master-list",
  "/calibration/master-list",
  "/documents/laboratory-scope",
  "/documents/internal-audit-schedule",
  "/documents/development-log",
  "/documents/nonconformance-log",
  "/documents/engineering-request-log",
] as const;

export interface ListCatalog {
  key: ListKey;
  title: string;
  docId: string;
  revision: string;
  route: (typeof LIVING_LIST_PATHS)[number];
  resource: "documents" | "calibration";
  landscape: boolean;
  /** Cells whose text is the revision. A data edit does not change them. */
  rev: { sheet: string; addr: string };
  revs?: { sheet: string; addr: string }[];
  /** Direct child of ISO Compliance Documents. Defaults to the Quality Manual. */
  folder?: string;
  /** Folder item name. Defaults to the title. */
  nodeName?: string;
  /** Download file name. Defaults to the document number plus the title. */
  fileName?: string;
  /** Center data cells the way the source workbook does. */
  centered?: boolean;
  dataStart: Record<string, number>;
  idColumn?: string;
  formula?: { sheet: string; column: string; nf: string; build: (row: number) => string };
}

const EQUIPMENT_SHEET = "LST-EQP-001 - Master Equipment ";
const LAB_SHEET = "LST-GEN-003 - Scope of Laborato";
const AUDIT_SCHEDULE_SHEET = "LST-GEN-002 - Internal Audit Sc";

export const LISTS: Record<ListKey, ListCatalog> = {
  "lst-eqp-001": {
    key: "lst-eqp-001",
    title: "Master Equipment List",
    docId: "LST-EQP-001",
    revision: "A",
    route: "/calibration/master-list",
    resource: "calibration",
    landscape: true,
    rev: { sheet: EQUIPMENT_SHEET, addr: "B2" },
    dataStart: { [EQUIPMENT_SHEET]: 6 },
    idColumn: "A",
    formula: { sheet: EQUIPMENT_SHEET, column: "I", nf: "mm-dd-yy", build: (row) => `H${row}+(G${row}*30)` },
  },
  "lst-gen-001": {
    key: "lst-gen-001",
    title: "Master Document List",
    docId: "LST-GEN-001",
    revision: "B",
    route: "/documents/master-list",
    resource: "documents",
    landscape: true,
    rev: { sheet: "Internal Documents", addr: "D2" },
    dataStart: { "Internal Documents": 4, "External Documents": 3 },
    idColumn: "A",
  },
  "lst-gen-002": {
    key: "lst-gen-002",
    title: "LST-GEN-002",
    docId: "LST-GEN-002",
    revision: "A",
    route: "/documents/internal-audit-schedule",
    resource: "documents",
    landscape: false,
    rev: { sheet: AUDIT_SCHEDULE_SHEET, addr: "D2" },
    folder: "Management System",
    nodeName: "LST-GEN-002",
    fileName: "LST-GEN-002.xlsx",
    dataStart: { [AUDIT_SCHEDULE_SHEET]: 6 },
  },
  "lst-gen-003": {
    key: "lst-gen-003",
    title: "Scope of Laboratory Activities",
    docId: "LST-GEN-003",
    revision: "A",
    route: "/documents/laboratory-scope",
    resource: "documents",
    landscape: false,
    rev: { sheet: LAB_SHEET, addr: "D2" },
    dataStart: { [LAB_SHEET]: 6 },
  },
  "lst-dev-001": {
    key: "lst-dev-001",
    title: "LST-DEV-001",
    docId: "LST-DEV-001",
    revision: "B",
    route: "/documents/development-log",
    resource: "documents",
    landscape: true,
    rev: { sheet: "Test Reports", addr: "B2" },
    revs: [
      { sheet: "Test Reports", addr: "B2" },
      { sheet: "Validation Report", addr: "B2" },
    ],
    folder: "Test Data Projects",
    nodeName: "LST-DEV-001",
    fileName: "LST-DEV-001.xlsx",
    centered: true,
    dataStart: { "Test Reports": 5, "Validation Report": 5 },
    idColumn: "A",
  },
  "lst-ncr-001": {
    key: "lst-ncr-001",
    title: "LST-NCR-001",
    docId: "LST-NCR-001",
    revision: "G",
    route: "/documents/nonconformance-log",
    resource: "documents",
    landscape: true,
    rev: { sheet: "LST-NCR-001 - NCR", addr: "B2" },
    revs: [
      { sheet: "LST-NCR-001 - NCR", addr: "B2" },
      { sheet: "LST-NCR-001 - QTN", addr: "B2" },
      { sheet: "LST-NCR-001 - CAR", addr: "B2" },
      { sheet: "LST-NCR-001 - RPN", addr: "B2" },
    ],
    folder: "Quality Logs",
    nodeName: "LST-NCR-001",
    fileName: "LST-NCR-001.xlsx",
    centered: true,
    dataStart: {
      "LST-NCR-001 - NCR": 5,
      "LST-NCR-001 - QTN": 5,
      "LST-NCR-001 - CAR": 5,
      "LST-NCR-001 - RPN": 5,
    },
    idColumn: "A",
  },
  "lst-eng-001": {
    key: "lst-eng-001",
    title: "LST-ENG-001",
    docId: "LST-ENG-001",
    revision: "A",
    route: "/documents/engineering-request-log",
    resource: "documents",
    landscape: true,
    rev: { sheet: "LST-ENG-001 - ECR Tracker - Rev", addr: "D2" },
    folder: "Engineering Logs",
    nodeName: "LST-ENG-001",
    fileName: "LST-ENG-001.xlsx",
    centered: true,
    dataStart: { "LST-ENG-001 - ECR Tracker - Rev": 6 },
  },
};

export function isListKey(value: string): value is ListKey {
  return (LIST_KEYS as readonly string[]).includes(value);
}

export function isLivingListPath(linkedPath: string | null | undefined): boolean {
  if (!linkedPath) return false;
  const path = linkedPath.split("?")[0] ?? linkedPath;
  return (LIVING_LIST_PATHS as readonly string[]).includes(path);
}

function seedBook(): Record<ListKey, { sheets: StoredSheet[] }> {
  const book = structuredClone(rawLists) as unknown as Record<ListKey, { sheets: StoredSheet[] }>;
  book["lst-dev-001"] = structuredClone(devLog) as unknown as { sheets: StoredSheet[] };
  book["lst-gen-002"] = structuredClone(auditSchedule) as unknown as { sheets: StoredSheet[] };
  book["lst-ncr-001"] = structuredClone(ncrLog) as unknown as { sheets: StoredSheet[] };
  book["lst-eng-001"] = structuredClone(engLog) as unknown as { sheets: StoredSheet[] };
  return book;
}

export function lockRevision(key: ListKey, sheets: StoredSheet[]): StoredSheet[] {
  const spec = LISTS[key];
  const locks = spec.revs ?? [spec.rev];
  return sheets.map((sheet) => {
    const lock = locks.find((item) => item.sheet === sheet.name);
    if (!lock) return sheet;
    const current = sheet.cells[lock.addr];
    if (!current) return sheet;
    const seed = seedBook()[key].sheets.find((item) => item.name === sheet.name)?.cells[lock.addr];
    return { ...sheet, cells: { ...sheet.cells, [lock.addr]: { ...current, v: seed?.v, kind: "rev" } } };
  });
}

/** Rows 1–3 are the workbook title block (title, Doc ID / Approved By / Date, status line). */
const HEADER_DEPTH = 3;

/** Title rows, plus the blank spacer above the column titles. The column-title row itself is not included. */
function headerMergeLimit(dataStart: number | undefined): number {
  if (dataStart == null) return HEADER_DEPTH;
  return Math.max(HEADER_DEPTH, columnHeaderRow(dataStart) - 1);
}

function mergeHitsHeader(merge: string, limit: number): boolean {
  const [start, end] = merge.split(":");
  if (!start || !end) return false;
  return parseAddr(start).row <= limit || parseAddr(end).row <= limit;
}

/** The row of column titles. Editing it is a structure change, not a cell edit. */
export function columnHeaderRow(dataStart: number): number {
  return Math.max(1, dataStart - 1);
}

/** A, B, Rev: A, or rev: aa. Empty when the text is not a revision letter. */
export function revisionLetter(value: string): string | null {
  const trimmed = value.trim();
  const prefixed = /^rev:\s*([A-Za-z]+)$/i.exec(trimmed);
  if (prefixed?.[1]) return prefixed[1].toUpperCase();
  if (/^[A-Za-z]+$/.test(trimmed)) return trimmed.toUpperCase();
  return null;
}

function replaceRevisionText(current: string, revision: string): string {
  const trimmed = current.trim();
  if (/^rev:\s*[A-Za-z]+$/i.test(trimmed)) return trimmed.replace(/[A-Za-z]+$/, revision);
  return revision;
}

/** A blank document revision takes the catalog letter. A saved letter, including workbook Rev G, stays. */
export function coalesceRevision(current: string, catalog: string): string {
  return current.trim() || catalog;
}

export function revCells(key: ListKey): { sheet: string; addr: string }[] {
  const spec = LISTS[key];
  return spec.revs ?? [spec.rev];
}

/** A header cell with no text can take the workbook value. A formula, or any text someone saved, stays. */
function headerNeedsSeed(cell: StoredCell | undefined): boolean {
  if (cell?.f) return false;
  return textOf(cell?.v) === "";
}

/**
 * Fills header cells that are missing or blank: Rev, Owner, Authorized By, Date, and the title.
 * A value someone already typed stays, even when it differs from the workbook.
 * Column widths and an added column's wider title merge stay as saved.
 */
function restoreSheetHeader(sheet: StoredSheet, seed: StoredSheet | undefined, mergeLimit: number): StoredSheet {
  if (!seed) return sheet;
  let changed = false;
  const cells = { ...sheet.cells };
  for (const [addr, cell] of Object.entries(seed.cells)) {
    if (parseAddr(addr).row > HEADER_DEPTH) continue;
    if (!headerNeedsSeed(cells[addr])) continue;
    if (textOf(cell?.v) === "") continue;
    cells[addr] = { ...cell };
    changed = true;
  }
  const origins = new Set(sheet.merges.map((merge) => merge.split(":")[0]).filter((addr): addr is string => Boolean(addr)));
  const missingMerges = seed.merges.filter((merge) => mergeHitsHeader(merge, mergeLimit) && !sheet.merges.includes(merge) && !origins.has(merge.split(":")[0] ?? ""));
  const merges = missingMerges.length > 0 ? [...sheet.merges, ...missingMerges] : sheet.merges;
  if (missingMerges.length > 0) changed = true;
  const rowHeights = { ...sheet.rowHeights };
  for (const [key, height] of Object.entries(seed.rowHeights)) {
    if (Number(key) > HEADER_DEPTH) continue;
    if (rowHeights[key] != null) continue;
    rowHeights[key] = height;
    changed = true;
  }
  const boxes = { ...(sheet.boxes ?? {}) };
  let boxesChanged = false;
  for (const [addr, box] of Object.entries(seed.boxes ?? {})) {
    if (parseAddr(addr).row > HEADER_DEPTH) continue;
    if (boxes[addr] != null) continue;
    boxes[addr] = box;
    boxesChanged = true;
  }
  if (!changed && !boxesChanged) return sheet;
  const nextBoxes = Object.keys(boxes).length > 0 ? boxes : undefined;
  return { ...sheet, cells, merges, rowHeights, boxes: nextBoxes };
}

/**
 * Fills blank cells in rows 1–3 from the controlled workbook: title, Doc ID, Rev,
 * location, Approved By / Authorized By / Owner, and Date.
 * An edited name, date, or revision letter is kept. Data rows and the document revision are left alone.
 * Per-tab letters stay as saved (LST-NCR-001 keeps Rev E / F on the tabs while the workbook revision stays G).
 */
export function restoreHeaderBlock(key: ListKey, sheets: StoredSheet[]): { sheets: StoredSheet[]; changed: boolean } {
  const seeds = seedBook()[key].sheets;
  let changed = false;
  const next = sheets.map((sheet) => {
    const restored = restoreSheetHeader(sheet, seeds.find((item) => item.name === sheet.name), headerMergeLimit(LISTS[key].dataStart[sheet.name]));
    if (restored !== sheet) changed = true;
    return restored;
  });
  return { sheets: changed ? next : sheets, changed };
}

function stripOmitted(sheet: StoredSheet, dataStart: number, idColumn: string): StoredSheet {
  const drop: number[] = [];
  for (let row = dataStart; row <= sheet.maxRow; row += 1) {
    const id = textOf(sheet.cells[cellAddr(idColumn, row)]?.v).toUpperCase();
    if (OMITTED_DOCUMENT_IDS.has(id)) drop.push(row);
  }
  let current = sheet;
  for (const row of drop.sort((a, b) => b - a)) current = deleteSheetRow(current, row);
  return current;
}

/** Shawn's workbook, with FRM-TST-001 and FRM-TST-002 left off the Master Document List. */
export function freshSheets(key: ListKey): StoredSheet[] {
  const sheets = seedBook()[key].sheets;
  if (key !== "lst-gen-001") return lockRevision(key, sheets);
  const spec = LISTS[key];
  return lockRevision(
    key,
    sheets.map((sheet) => {
      const start = spec.dataStart[sheet.name];
      if (sheet.name !== "Internal Documents" || start == null || !spec.idColumn) return sheet;
      return stripOmitted(sheet, start, spec.idColumn);
    }),
  );
}

export interface DocumentAppend {
  documentId: string;
  title: string;
  currentRev: string;
  approvalDate: string | null;
  approvedBy: string;
  location: string;
  status: string;
  revHistory: string;
}

export interface EquipmentAppend {
  assetId: string;
  name: string;
  manufacturer: string;
  serial: string;
  location: string;
  method: string;
  intervalMonths: number;
  lastCal: string;
  status: string;
}

function idsIn(sheet: StoredSheet, column: string, dataStart: number): Set<string> {
  const ids = new Set<string>();
  for (let row = dataStart; row <= sheet.maxRow; row += 1) {
    const id = textOf(sheet.cells[cellAddr(column, row)]?.v).toUpperCase();
    if (id) ids.add(id);
  }
  return ids;
}

function writeInput(sheet: StoredSheet, addr: string, value: string | number | null, extra: Partial<StoredCell> = {}): void {
  const current = sheet.cells[addr];
  sheet.cells[addr] = { ...current, ...extra, v: value, kind: current?.kind === "formula" || current?.kind === "rev" ? current.kind : "input" };
}

/** Rows from the register that are not already on Internal Documents. FRM-TST stays off. */
export function appendDocuments(sheets: StoredSheet[], rows: DocumentAppend[]): { sheets: StoredSheet[]; added: string[] } {
  const spec = LISTS["lst-gen-001"];
  const name = "Internal Documents";
  const start = spec.dataStart[name] ?? 4;
  const next = sheets.map((sheet) => ({ ...sheet, cells: { ...sheet.cells } }));
  const sheet = next.find((item) => item.name === name);
  if (!sheet) return { sheets, added: [] };
  const present = idsIn(sheet, "A", start);
  const added: string[] = [];
  for (const row of rows) {
    const id = row.documentId.trim();
    if (!id || OMITTED_DOCUMENT_IDS.has(id.toUpperCase()) || present.has(id.toUpperCase())) continue;
    let target = nextDataRow(sheet, start, ["A", "B", "C", "D", "E", "F", "G", "H"]);
    if (target > sheet.maxRow) {
      const grown = appendSheetRow(sheet);
      Object.assign(sheet, grown);
      target = sheet.maxRow;
    }
    writeInput(sheet, cellAddr("A", target), id);
    writeInput(sheet, cellAddr("B", target), row.title);
    writeInput(sheet, cellAddr("C", target), row.currentRev);
    writeInput(sheet, cellAddr("D", target), row.approvalDate, { nf: "mm-dd-yy" });
    writeInput(sheet, cellAddr("E", target), row.approvedBy);
    writeInput(sheet, cellAddr("F", target), row.location);
    writeInput(sheet, cellAddr("G", target), row.status);
    writeInput(sheet, cellAddr("H", target), row.revHistory, { wrap: true });
    present.add(id.toUpperCase());
    added.push(id);
  }
  return { sheets: next, added };
}

/** Equipment records whose asset id is not already in column A. */
export function appendEquipment(sheets: StoredSheet[], rows: EquipmentAppend[]): { sheets: StoredSheet[]; added: string[] } {
  const spec = LISTS["lst-eqp-001"];
  const name = spec.formula?.sheet ?? EQUIPMENT_SHEET;
  const start = spec.dataStart[name] ?? 6;
  const next = sheets.map((sheet) => ({ ...sheet, cells: { ...sheet.cells } }));
  const sheet = next.find((item) => item.name === name);
  if (!sheet || !spec.formula) return { sheets, added: [] };
  const present = idsIn(sheet, "A", start);
  const added: string[] = [];
  const usedColumns = ["A", "B", spec.formula.column];
  for (const row of rows) {
    const id = row.assetId.trim();
    if (!id || present.has(id.toUpperCase())) continue;
    let target = nextDataRow(sheet, start, usedColumns);
    if (target > sheet.maxRow) {
      const grown = appendSheetRow(sheet, spec.formula);
      Object.assign(sheet, grown);
      target = sheet.maxRow;
    } else if (!sheet.cells[cellAddr("I", target)]?.f) {
      sheet.cells[cellAddr("I", target)] = { f: spec.formula.build(target), nf: spec.formula.nf, kind: "formula" };
    }
    writeInput(sheet, cellAddr("A", target), id);
    writeInput(sheet, cellAddr("B", target), row.name);
    writeInput(sheet, cellAddr("C", target), row.manufacturer);
    writeInput(sheet, cellAddr("D", target), row.serial);
    writeInput(sheet, cellAddr("E", target), row.location);
    writeInput(sheet, cellAddr("F", target), row.method);
    writeInput(sheet, cellAddr("G", target), row.intervalMonths);
    writeInput(sheet, cellAddr("H", target), row.lastCal || null, { nf: "mm-dd-yy" });
    writeInput(sheet, cellAddr("J", target), row.status);
    present.add(id.toUpperCase());
    added.push(id);
  }
  return { sheets: next, added };
}

export interface CellPatch {
  v?: string | number | null;
}

export interface CellChange {
  sheet: string;
  addr: string;
  old: string;
  next: string;
}

function shownRaw(cell: StoredCell | undefined): string {
  if (!cell || cell.v == null || cell.v === "") return "";
  return String(cell.v);
}

const LOCATION_LINE = /^location\s*:/i;

/** A header cell that already reads as the workbook's Location line. */
export function isLocationHeaderCell(addr: string, cell: StoredCell | undefined): boolean {
  if (!cell || parseAddr(addr).row > HEADER_DEPTH) return false;
  if (cell.kind === "location") return true;
  return typeof cell.v === "string" && LOCATION_LINE.test(cell.v.trim());
}

/** The Location cell text, with the in-app path after the label. */
export function locationCellText(path: string): string {
  return `Location: ${path.trim()}`;
}

/**
 * Writes the current folder path into Location cells on one sheet.
 * Called only when someone chooses Insert current path. Opening the list does not call this,
 * so a location that is already filled stays as it is.
 */
export function insertLocationPath(
  key: ListKey,
  sheets: StoredSheet[],
  sheetName: string,
  path: string,
): { sheets: StoredSheet[]; changes: CellChange[] } {
  void key;
  const value = locationCellText(path);
  const changes: CellChange[] = [];
  let touched = false;
  const next = sheets.map((sheet) => {
    if (sheet.name !== sheetName) return sheet;
    const cells = { ...sheet.cells };
    for (const [addr, cell] of Object.entries(cells)) {
      if (!isLocationHeaderCell(addr, cell)) continue;
      const before = shownRaw(cell);
      if (before === value) continue;
      cells[addr] = { ...cell, v: value, kind: "location" };
      changes.push({ sheet: sheet.name, addr, old: before || "blank", next: value });
      touched = true;
    }
    return touched ? { ...sheet, cells } : sheet;
  });
  return { sheets: changes.length > 0 ? next : sheets, changes };
}

function editedKind(addr: string, current: StoredCell | undefined, value: string | number | null): StoredCell["kind"] {
  if (current?.kind === "rev" || current?.kind === "label") return current.kind;
  if (current?.kind === "location" || (current != null && isLocationHeaderCell(addr, current))) {
    return typeof value === "string" && LOCATION_LINE.test(value.trim()) ? "location" : "input";
  }
  return "input";
}

/**
 * Copy edited values onto the stored sheet.
 * Header text, dates, names, Rev, and location can change. Formula cells keep their formulas.
 * The column-title row is left alone; renaming a column is a structure change.
 * A data edit does not change the document revision by itself.
 */
export function applyInputPatch(key: ListKey, sheets: StoredSheet[], patches: Array<{ name: string; cells: Record<string, CellPatch> }>): { sheets: StoredSheet[]; changes: CellChange[] } {
  const spec = LISTS[key];
  const changes: CellChange[] = [];
  const next = sheets.map((sheet) => ({ ...sheet, cells: { ...sheet.cells } }));
  for (const patch of patches) {
    const sheet = next.find((item) => item.name === patch.name);
    if (!sheet) continue;
    const start = spec.dataStart[sheet.name] ?? 1;
    const headerRow = columnHeaderRow(start);
    for (const [addr, incoming] of Object.entries(patch.cells)) {
      const { col, row } = parseAddr(addr);
      if (row < 1 || columnIndex(col) > sheet.maxCol) continue;
      if (row === headerRow) continue;
      const current = sheet.cells[addr];
      if (current?.kind === "formula" || current?.f) continue;
      const value = incoming.v === "" ? null : (incoming.v ?? null);
      const before = shownRaw(current);
      const after = value == null ? "" : String(value);
      if (before === after) continue;
      sheet.cells[addr] = { ...current, v: value, kind: editedKind(addr, current, value), nf: current?.nf };
      changes.push({ sheet: sheet.name, addr, old: before || "blank", next: after || "blank" });
    }
  }
  return {
    sheets: next.map((sheet) => (key === "lst-gen-001" && sheet.name === "Internal Documents" ? stripOmitted(sheet, spec.dataStart[sheet.name] ?? 4, "A") : sheet)),
    changes,
  };
}

export function addDataRow(key: ListKey, sheets: StoredSheet[], sheetName: string): { sheets: StoredSheet[]; row: number } | null {
  const spec = LISTS[key];
  const start = spec.dataStart[sheetName];
  if (start == null) return null;
  const next: StoredSheet[] = sheets.map((sheet) => ({
    ...sheet,
    cells: { ...sheet.cells },
    merges: [...sheet.merges],
    lists: sheet.lists?.map((list) => ({ ...list, options: [...list.options] })),
  }));
  const sheet = next.find((item) => item.name === sheetName);
  if (!sheet) return null;
  const formula = spec.formula && spec.formula.sheet === sheetName ? spec.formula : undefined;
  const columns = formula ? ["A", "B", formula.column] : ["A", "B", "C", "D", "E", "F", "G", "H"];
  let row = nextDataRow(sheet, start, columns);
  if (row > sheet.maxRow) {
    const grown = coverNewRow(appendSheetRow(sheet, formula));
    const index = next.findIndex((item) => item.name === sheetName);
    next[index] = grown;
    row = grown.maxRow;
  } else if (formula && !sheet.cells[cellAddr(formula.column, row)]?.f) {
    sheet.cells[cellAddr(formula.column, row)] = { f: formula.build(row), nf: formula.nf, kind: "formula" };
  }
  return { sheets: next, row };
}

/** Insert a blank row above or below a data row. Nothing in the new row is numbered. */
export function insertDataRow(key: ListKey, sheets: StoredSheet[], sheetName: string, atRow: number): { sheets: StoredSheet[]; row: number } | null {
  const spec = LISTS[key];
  const start = spec.dataStart[sheetName];
  if (start == null || atRow < start) return null;
  const formula = spec.formula?.sheet === sheetName ? spec.formula : undefined;
  let placed = false;
  const next = sheets.map((sheet) => {
    if (sheet.name !== sheetName) return sheet;
    if (atRow > sheet.maxRow + 1) return sheet;
    placed = true;
    let grown = insertSheetRow(sheet, atRow);
    if (formula) {
      grown = {
        ...grown,
        cells: {
          ...grown.cells,
          [cellAddr(formula.column, atRow)]: { f: formula.build(atRow), nf: formula.nf, kind: "formula" },
        },
      };
    }
    return coverRow(grown, atRow);
  });
  if (!placed) return null;
  return { sheets: next, row: atRow };
}

export function removeDataRow(key: ListKey, sheets: StoredSheet[], sheetName: string, row: number): StoredSheet[] | null {
  return removeDataRows(key, sheets, sheetName, [row]);
}

/** Delete data rows from the bottom up so each index still points at the row the person chose. */
export function removeDataRows(key: ListKey, sheets: StoredSheet[], sheetName: string, rows: number[]): StoredSheet[] | null {
  const spec = LISTS[key];
  const start = spec.dataStart[sheetName];
  const sheet = sheets.find((item) => item.name === sheetName);
  if (start == null || !sheet) return null;
  const unique = [...new Set(rows)].filter((row) => Number.isInteger(row));
  if (unique.length === 0 || unique.some((row) => row < start || row > sheet.maxRow)) return null;
  let current = sheets;
  for (const row of unique.sort((a, b) => b - a)) {
    current = current.map((item) => (item.name === sheetName ? deleteSheetRow(item, row) : item));
  }
  return current;
}

export function rowValueList(sheet: StoredSheet, row: number): string {
  const parts: string[] = [];
  for (let col = 1; col <= sheet.maxCol; col += 1) {
    const addr = cellAddr(columnLetter(col), row);
    const cell = sheet.cells[addr];
    if (!cell || cell.f) continue;
    const text = textOf(cell.v);
    if (!text) continue;
    parts.push(`${addr} ${quote(text)}`);
    if (parts.length >= 8) break;
  }
  return parts.join(", ");
}

export interface ColumnEdit {
  sheets: StoredSheet[];
  revision: string;
  bumped: boolean;
  detail: string;
}

function withSheet(sheets: StoredSheet[], sheetName: string, sheet: StoredSheet): StoredSheet[] {
  return sheets.map((item) => (item.name === sheetName ? sheet : item));
}

function bumpSheetRevision(key: ListKey, sheets: StoredSheet[], sheetName: string, revision: string): { sheets: StoredSheet[]; revision: string } {
  const nextRevision = bumpRevision(revision);
  const locks = revCells(key).filter((item) => item.sheet === sheetName);
  return {
    revision: nextRevision,
    sheets: sheets.map((sheet) => {
      if (sheet.name !== sheetName) return sheet;
      const cells = { ...sheet.cells };
      for (const lock of locks) {
        const current = cells[lock.addr];
        if (!current) continue;
        cells[lock.addr] = { ...current, v: replaceRevisionText(textOf(current.v), nextRevision), kind: "rev" };
      }
      return { ...sheet, cells };
    }),
  };
}

/** Rename the column title. This is a structure change and moves the revision forward. */
export function renameListColumn(key: ListKey, sheets: StoredSheet[], revision: string, sheetName: string, col: string, name: string): ColumnEdit | null {
  const spec = LISTS[key];
  const start = spec.dataStart[sheetName];
  const sheet = sheets.find((item) => item.name === sheetName);
  const letter = col.trim().toUpperCase();
  const title = name.trim();
  if (start == null || !sheet || !title) return null;
  const index = columnIndex(letter);
  if (index < 1 || index > sheet.maxCol) return null;
  const addr = cellAddr(letter, columnHeaderRow(start));
  const before = textOf(sheet.cells[addr]?.v);
  if (before === title) return { sheets, revision, bumped: false, detail: "" };
  const renamed = withSheet(sheets, sheetName, {
    ...sheet,
    cells: { ...sheet.cells, [addr]: { ...sheet.cells[addr], v: title, kind: "label" } },
  });
  const bumped = bumpSheetRevision(key, renamed, sheetName, revision);
  return {
    sheets: bumped.sheets,
    revision: bumped.revision,
    bumped: true,
    detail: `renamed column ${letter} on ${sheetName.trim()} from ${quote(before || "blank")} to ${quote(title)}`,
  };
}

/** Add a blank column. `after` is the column it sits to the right of. Omit it to add one at the end. */
export function addListColumn(key: ListKey, sheets: StoredSheet[], revision: string, sheetName: string, after: string | null): ColumnEdit | null {
  const spec = LISTS[key];
  const start = spec.dataStart[sheetName];
  const sheet = sheets.find((item) => item.name === sheetName);
  if (start == null || !sheet) return null;
  const afterIndex = after ? columnIndex(after.trim().toUpperCase()) : sheet.maxCol;
  if (after && (afterIndex < 1 || afterIndex > sheet.maxCol)) return null;
  const at = afterIndex + 1;
  let grown = insertSheetColumn(sheet, at);
  const header = cellAddr(columnLetter(at), columnHeaderRow(start));
  grown = { ...grown, cells: { ...grown.cells, [header]: { ...grown.cells[header], v: null, kind: "label" } } };
  const bumped = bumpSheetRevision(key, withSheet(sheets, sheetName, grown), sheetName, revision);
  const place = after ? `after ${after.trim().toUpperCase()}` : "at the end";
  return {
    sheets: bumped.sheets,
    revision: bumped.revision,
    bumped: true,
    detail: `added a blank column ${columnLetter(at)} ${place} on ${sheetName.trim()}`,
  };
}

/** Remove one column and the values in it. */
export function removeListColumn(key: ListKey, sheets: StoredSheet[], revision: string, sheetName: string, col: string): ColumnEdit | null {
  const spec = LISTS[key];
  const start = spec.dataStart[sheetName];
  const sheet = sheets.find((item) => item.name === sheetName);
  const letter = col.trim().toUpperCase();
  if (start == null || !sheet || sheet.maxCol <= 1) return null;
  const index = columnIndex(letter);
  if (index < 1 || index > sheet.maxCol) return null;
  const title = textOf(sheet.cells[cellAddr(letter, columnHeaderRow(start))]?.v);
  const grown = deleteSheetColumn(sheet, index);
  const bumped = bumpSheetRevision(key, withSheet(sheets, sheetName, grown), sheetName, revision);
  return {
    sheets: bumped.sheets,
    revision: bumped.revision,
    bumped: true,
    detail: `removed column ${letter}${title ? ` (${title})` : ""} on ${sheetName.trim()}`,
  };
}

function quote(value: string): string {
  return value === "blank" ? "blank" : `"${value}"`;
}

export function changeSummary(who: string, changes: CellChange[], when?: string): string {
  if (changes.length === 0) return "";
  const lines = changes.slice(0, 12).map((change) => `${change.addr} on ${change.sheet} from ${quote(change.old)} to ${quote(change.next)}`);
  const more = changes.length > 12 ? ` and ${changes.length - 12} more cells` : "";
  const noun = changes.length === 1 ? "cell" : "cells";
  const dated = when ? ` on ${when}` : "";
  return `${who} changed ${changes.length} ${noun}${dated}. ${lines.join(". ")}${more}.`;
}

export function rowSummary(who: string, action: "added" | "inserted" | "deleted", sheet: string, row: number, label?: string, when?: string): string {
  const what = label ? ` (${label})` : "";
  const dated = when ? ` on ${when}` : "";
  if (action === "inserted") return `${who} inserted a blank row at row ${row} on ${sheet}${dated}.`;
  if (action === "added") return `${who} added a blank row at row ${row} on ${sheet}${dated}.`;
  return `${who} deleted row ${row} on ${sheet}${what}${dated}.`;
}

export function rowsDeletedSummary(who: string, sheet: string, rows: Array<{ row: number; label?: string; values?: string }>, when?: string): string {
  const dated = when ? ` on ${when}` : "";
  const lines = rows.map((row) => {
    const label = row.label ? ` (${row.label})` : "";
    const values = row.values ? `: ${row.values}` : "";
    return `row ${row.row}${label}${values}`;
  });
  const noun = rows.length === 1 ? "row" : "rows";
  return `${who} deleted ${rows.length} ${noun} on ${sheet.trim()}${dated}. ${lines.join(". ")}.`;
}

export function structureSummary(who: string, detail: string, fromRevision: string, toRevision: string, when?: string): string {
  const dated = when ? ` on ${when}` : "";
  return `${who} ${detail}${dated}. Revision moved from ${fromRevision} to ${toRevision}.`;
}

export const RETIRED_LIST_TITLES = new Set(["master equipment list", "master document list", "scope of laboratory activities"]);
export const RETIRED_LIST_NUMBERS = new Set(["LST-EQP-001", "LST-GEN-001", "LST-GEN-003"]);
export const RETIRED_LIST_KEYS = new Set(["lst-eqp-001", "lst-gen-001", "lst-gen-003"]);
const DEV_LOG_TITLES = new Set(["lst-dev-001", "development log", "development log (register)"]);
const DEV_LOG_NUMBERS = new Set(["LST-DEV-001"]);
const AUDIT_SCHEDULE_TITLES = new Set(["lst-gen-002", "internal audit schedule"]);
const AUDIT_SCHEDULE_NUMBERS = new Set(["LST-GEN-002"]);
const AUDIT_SCHEDULE_KEYS = new Set(["lst-gen-002"]);
const ENG_LOG_TITLES = new Set([
  "lst-eng-001",
  "engineering request change log",
  "ecr tracker",
  "lst-eng-001 - ecr tracker - rev",
]);
const ENG_LOG_NUMBERS = new Set(["LST-ENG-001"]);

export function normalizeListTitle(name: string): string {
  return name.replace(/\.(xlsx|xls|xlsm|pdf|docx)$/i, "").trim().toLowerCase();
}

export function titleMatchesList(name: string): boolean {
  return RETIRED_LIST_TITLES.has(normalizeListTitle(name));
}

export function titleMatchesDevLog(name: string): boolean {
  return DEV_LOG_TITLES.has(normalizeListTitle(name));
}

export function titleMatchesAuditSchedule(name: string): boolean {
  return AUDIT_SCHEDULE_TITLES.has(normalizeListTitle(name));
}

export function titleMatchesEngLog(name: string): boolean {
  return ENG_LOG_TITLES.has(normalizeListTitle(name));
}

export interface CleanupFolder {
  id: number;
  name: string;
  parentId: number | null;
  pdfPath?: string | null;
  documentId?: number | null;
  linkedPath?: string | null;
}

export interface CleanupDocument {
  id: number;
  title: string;
  isDeleted?: boolean;
}

export interface CleanupTemplate {
  id: number;
  formKey: string;
  formId: string;
  title: string;
}

export interface CleanupPlan {
  documentIds: number[];
  templateIds: number[];
  folderNodeIds: number[];
}

const BLANK_FOLDER_NAMES = new Set(["Blank Form Templates", "Blank Forms Templates", "03_Blank_Forms_Templates"]);

function ancestorNames(folders: CleanupFolder[], id: number | null): string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  const seen = new Set<number>();
  let current = id == null ? undefined : byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId == null ? undefined : byId.get(current.parentId);
  }
  return names;
}

function underIsoChild(names: string[], child: string): boolean {
  const iso = names.indexOf("ISO Compliance Documents");
  if (iso < 0) return false;
  return names[iso + 1] === child;
}

function underQualityManual(names: string[]): boolean {
  return underIsoChild(names, "Quality Manual");
}

function underBlankForms(names: string[]): boolean {
  return names.some((name) => BLANK_FOLDER_NAMES.has(name));
}

function filedRecord(linkedPath: string | null | undefined): boolean {
  if (!linkedPath) return false;
  return /\/\d+(?:\/|$)/.test(linkedPath);
}

/**
 * Old Quality Manual uploads of the three lists, Development Log copies under Test Data Projects,
 * Internal Audit Schedule uploads, Engineering Request Change Log copies under Engineering Logs,
 * and blank templates with those titles.
 * A Non-Conformance Log blank is not one of these and stays in Blank Forms Templates.
 * The Engineering Change Request workflow blank is a different document and stays.
 * Living list links and filled records stay. The Audits drawer named Internal Audit Schedule
 * stays too, unless that row itself is an uploaded file.
 */
export function planListCleanup(folders: CleanupFolder[], documents: CleanupDocument[], templates: CleanupTemplate[]): CleanupPlan {
  const docs = new Map(documents.filter((doc) => !doc.isDeleted).map((doc) => [doc.id, doc]));
  const documentIds = new Set<number>();
  const folderNodeIds = new Set<number>();
  const templateIds = new Set<number>();

  for (const template of templates) {
    const number = template.formId.trim().toUpperCase();
    if (
      RETIRED_LIST_KEYS.has(template.formKey) ||
      template.formKey === "lst-eng-001" ||
      titleMatchesList(template.title) ||
      RETIRED_LIST_NUMBERS.has(number) ||
      titleMatchesDevLog(template.title) ||
      DEV_LOG_NUMBERS.has(number) ||
      AUDIT_SCHEDULE_KEYS.has(template.formKey) ||
      titleMatchesAuditSchedule(template.title) ||
      AUDIT_SCHEDULE_NUMBERS.has(number) ||
      titleMatchesEngLog(template.title) ||
      ENG_LOG_NUMBERS.has(number)
    ) {
      templateIds.add(template.id);
    }
  }

  for (const folder of folders) {
    if (isLivingListPath(folder.linkedPath)) continue;
    if (filedRecord(folder.linkedPath)) continue;
    const names = ancestorNames(folders, folder.id);
    const linked = folder.documentId == null ? undefined : docs.get(folder.documentId);
    const nameHit = titleMatchesList(folder.name) || (linked ? titleMatchesList(linked.title) : false);
    const devHit = titleMatchesDevLog(folder.name) || (linked ? titleMatchesDevLog(linked.title) : false);
    const auditHit = titleMatchesAuditSchedule(folder.name) || (linked ? titleMatchesAuditSchedule(linked.title) : false);
    const engHit = titleMatchesEngLog(folder.name) || (linked ? titleMatchesEngLog(linked.title) : false);
    if (!nameHit && !devHit && !auditHit && !engHit) continue;
    const filedHere = Boolean(folder.pdfPath || folder.documentId != null);
    const inManual = nameHit && underQualityManual(names) && filedHere;
    const inProjects = devHit && underIsoChild(names, "Test Data Projects") && filedHere;
    const auditUpload = auditHit && filedHere && names.includes("ISO Compliance Documents");
    const inEngineering = engHit && underIsoChild(names, "Engineering Logs") && filedHere;
    if (inManual || inProjects || auditUpload || inEngineering) {
      if (folder.documentId != null && docs.has(folder.documentId)) documentIds.add(folder.documentId);
      folderNodeIds.add(folder.id);
      continue;
    }
    if (underBlankForms(names)) folderNodeIds.add(folder.id);
  }

  return { documentIds: [...documentIds], templateIds: [...templateIds], folderNodeIds: [...folderNodeIds] };
}

export const EQUIPMENT_STATUSES = ["Active", "Out of Service", "Scrapped", "Cal Not Required (CNR)"] as const;
