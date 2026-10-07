import rawLists from "./seeds/lists.json" with { type: "json" };
import devLog from "./seeds/lst-dev-001.json" with { type: "json" };
import {
  appendSheetRow,
  cellAddr,
  coverNewRow,
  deleteSheetRow,
  nextDataRow,
  parseAddr,
  textOf,
  type StoredCell,
  type StoredSheet,
} from "./math.js";

export type { StoredCell, StoredSheet } from "./math.js";

export const LIST_KEYS = ["lst-eqp-001", "lst-gen-001", "lst-gen-003", "lst-dev-001"] as const;
export type ListKey = (typeof LIST_KEYS)[number];

export const OMITTED_DOCUMENT_IDS = new Set(["FRM-TST-001", "FRM-TST-002"]);

export const LIVING_LIST_PATHS = [
  "/documents/master-list",
  "/calibration/master-list",
  "/documents/laboratory-scope",
  "/documents/development-log",
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

/** Copy editable values onto the stored sheet. Labels, formulas, and Rev stay as they are. */
export function applyInputPatch(key: ListKey, sheets: StoredSheet[], patches: Array<{ name: string; cells: Record<string, CellPatch> }>): { sheets: StoredSheet[]; changes: CellChange[] } {
  const spec = LISTS[key];
  const changes: CellChange[] = [];
  const next = sheets.map((sheet) => ({ ...sheet, cells: { ...sheet.cells } }));
  for (const patch of patches) {
    const sheet = next.find((item) => item.name === patch.name);
    if (!sheet) continue;
    const start = spec.dataStart[sheet.name] ?? 1;
    for (const [addr, incoming] of Object.entries(patch.cells)) {
      const { row } = parseAddr(addr);
      const current = sheet.cells[addr];
      if (current && current.kind !== "input") continue;
      if (!current && row < start) continue;
      const value = incoming.v === "" ? null : incoming.v ?? null;
      const before = shownRaw(current);
      const after = value == null ? "" : String(value);
      if (before === after) continue;
      sheet.cells[addr] = { ...current, v: value, kind: "input", nf: current?.nf };
      changes.push({ sheet: sheet.name, addr, old: before || "blank", next: after || "blank" });
    }
  }
  return { sheets: lockRevision(key, next.map((sheet) => (key === "lst-gen-001" && sheet.name === "Internal Documents" ? stripOmitted(sheet, spec.dataStart[sheet.name] ?? 4, "A") : sheet))), changes };
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
  return { sheets: lockRevision(key, next), row };
}

export function removeDataRow(key: ListKey, sheets: StoredSheet[], sheetName: string, row: number): StoredSheet[] | null {
  const spec = LISTS[key];
  const start = spec.dataStart[sheetName];
  if (start == null || row < start) return null;
  const next = sheets.map((sheet) => (sheet.name === sheetName ? deleteSheetRow(sheet, row) : sheet));
  return lockRevision(key, next);
}

function quote(value: string): string {
  return value === "blank" ? "blank" : `"${value}"`;
}

export function changeSummary(who: string, changes: CellChange[]): string {
  if (changes.length === 0) return "";
  const lines = changes.slice(0, 12).map((change) => `${change.addr} on ${change.sheet} from ${quote(change.old)} to ${quote(change.next)}`);
  const more = changes.length > 12 ? ` and ${changes.length - 12} more cells` : "";
  const noun = changes.length === 1 ? "cell" : "cells";
  return `${who} changed ${changes.length} ${noun}. ${lines.join(". ")}${more}.`;
}

export function rowSummary(who: string, action: "added" | "deleted", sheet: string, row: number, label?: string): string {
  const what = label ? ` (${label})` : "";
  return action === "added" ? `${who} added a row at row ${row} on ${sheet}.` : `${who} deleted row ${row} on ${sheet}${what}.`;
}

export const RETIRED_LIST_TITLES = new Set(["master equipment list", "master document list", "scope of laboratory activities"]);
export const RETIRED_LIST_NUMBERS = new Set(["LST-EQP-001", "LST-GEN-001", "LST-GEN-003"]);
export const RETIRED_LIST_KEYS = new Set(["lst-eqp-001", "lst-gen-001", "lst-gen-003"]);
const DEV_LOG_TITLES = new Set(["lst-dev-001", "development log", "development log (register)"]);
const DEV_LOG_NUMBERS = new Set(["LST-DEV-001"]);

export function normalizeListTitle(name: string): string {
  return name.replace(/\.(xlsx|xls|xlsm|pdf|docx)$/i, "").trim().toLowerCase();
}

export function titleMatchesList(name: string): boolean {
  return RETIRED_LIST_TITLES.has(normalizeListTitle(name));
}

export function titleMatchesDevLog(name: string): boolean {
  return DEV_LOG_TITLES.has(normalizeListTitle(name));
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
 * and blank templates with those titles. A Non-Conformance Log blank is not one of these and stays
 * in Blank Forms Templates. Living list links and filled records stay.
 */
export function planListCleanup(folders: CleanupFolder[], documents: CleanupDocument[], templates: CleanupTemplate[]): CleanupPlan {
  const docs = new Map(documents.filter((doc) => !doc.isDeleted).map((doc) => [doc.id, doc]));
  const documentIds = new Set<number>();
  const folderNodeIds = new Set<number>();
  const templateIds = new Set<number>();

  for (const template of templates) {
    const number = template.formId.trim().toUpperCase();
    if (RETIRED_LIST_KEYS.has(template.formKey) || titleMatchesList(template.title) || RETIRED_LIST_NUMBERS.has(number) || titleMatchesDevLog(template.title) || DEV_LOG_NUMBERS.has(number)) {
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
    if (!nameHit && !devHit) continue;
    const filedHere = Boolean(folder.pdfPath || folder.documentId != null);
    const inManual = nameHit && underQualityManual(names) && filedHere;
    const inProjects = devHit && underIsoChild(names, "Test Data Projects") && filedHere;
    if (inManual || inProjects) {
      if (folder.documentId != null && docs.has(folder.documentId)) documentIds.add(folder.documentId);
      folderNodeIds.add(folder.id);
      continue;
    }
    if (underBlankForms(names)) folderNodeIds.add(folder.id);
  }

  return { documentIds: [...documentIds], templateIds: [...templateIds], folderNodeIds: [...folderNodeIds] };
}

export const EQUIPMENT_STATUSES = ["Active", "Out of Service", "Scrapped", "Cal Not Required (CNR)"] as const;
