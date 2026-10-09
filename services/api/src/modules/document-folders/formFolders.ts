import { eq, inArray, isNotNull } from "drizzle-orm";
import { company } from "../../drizzle/schema/company.js";
import { audits } from "../../drizzle/schema/audits.js";
import { capa } from "../../drizzle/schema/capa.js";
import { equipment } from "../../drizzle/schema/calibration.js";
import { changeRequests } from "../../drizzle/schema/change.js";
import { documentChangeRequests } from "../../drizzle/schema/documentChangeRequests.js";
import { controlledFormTemplates } from "../../drizzle/schema/controlledForms.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import { eightD } from "../../drizzle/schema/eightD.js";
import { formFilings } from "../../drizzle/schema/formFilings.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { qmsForms } from "../../drizzle/schema/qmsForms.js";
import { riskAssessments } from "../../drizzle/schema/risk.js";
import { trainingCourses } from "../../drizzle/schema/training.js";
import type { Db } from "../../lib/requestDb.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { AppError } from "../../utils/appError.js";
import { folderIdentityKey } from "./duplicateFolders.js";
import { rememberDeletedFormFolders, rememberFormFolderName } from "./folderTombstones.js";
import { folderIsBlankLibrary, ISO_DOCUMENTS_FOLDER } from "./formFiling.js";
import { folderLocationLabel } from "./mainIsoFolders.js";
import { FILEABLE_FORM_KEYS } from "./editableForms.js";
import { canonicalOpenPath, filterLiveFilings, repairSavedFormListings } from "./savedFormLinks.js";
import { FORM_TEMPLATES, filedRecordName, fileNamePatternFor, type FormTemplateSeed } from "./formFiling.js";
import { listFormTemplates } from "./formTemplates.js";

/**
 * One Folders row per fillable form. The name is the blank / QMS title.
 * Saved copies are listed separately. A blank template is not a saved file.
 */
export interface FormFolderSummary {
  /** Stable id for the folder. One of `formKeys`. */
  formKey: string;
  /** Every source that belongs in this one folder (module form and blank template). */
  formKeys: string[];
  /** Clean title, without an internal key or a trailing acronym. */
  title: string;
  /** Real document number when this folder has one. Empty when it does not. */
  formId: string;
  /** What the Folders tab shows. */
  name: string;
  savedCount: number;
}

export interface SavedFill {
  recordId: number;
  fileName: string;
  /** ISO timestamp. Newest first. */
  savedAt: string;
  openPath: string;
  /** Documents folder this copy was saved into. Null when the form is not filed there. */
  documentsFolderId: number | null;
}

export interface FormFolderDetail {
  formKey: string;
  formKeys: string[];
  title: string;
  formId: string;
  name: string;
  fills: SavedFill[];
}

export interface FolderTemplate {
  formKey: string;
  title: string;
  formId: string;
  start: unknown;
}

interface Stamp {
  id: number;
  label: string | null;
  formNumber: string | null;
  /** User-entered record number. Null or blank is not replaced with the database id. */
  number?: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  /** False until the user saves. Omitted when this table has no save timestamp. */
  saved?: boolean;
}

/**
 * First Article module folders are retired.
 * The blank First Article Inspection Report template stays in Blank Forms Templates.
 */
export const RETIRED_FORM_FOLDER_KEYS = new Set(["frm-fai-001", "first_article_inspection"]);

/** Document-tree home for copies saved into a per-form folder. Folder Explorer does not list it. */
export const SAVED_FORM_FOLDERS_ROOT = "Saved Form Folders";

/** Newest save date first, then file name, then record id. */
export function compareSavedFills(a: Pick<SavedFill, "savedAt" | "fileName" | "recordId">, b: Pick<SavedFill, "savedAt" | "fileName" | "recordId">): number {
  const byDate = b.savedAt.localeCompare(a.savedAt);
  if (byDate !== 0) return byDate;
  const byName = a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: "base" });
  if (byName !== 0) return byName;
  return a.recordId - b.recordId;
}

export function sortSavedFills<T extends Pick<SavedFill, "savedAt" | "fileName" | "recordId">>(rows: T[]): T[] {
  return [...rows].sort(compareSavedFills);
}

export function isoStamp(updatedAt: Date | string | null | undefined, createdAt: Date | string | null | undefined): string {
  for (const value of [updatedAt, createdAt]) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
    if (typeof value === "string" && value.trim()) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }
  return new Date(0).toISOString();
}

/** File name for a saved copy that was not given one by Save as. */
export function savedFillFileName(input: { formId: string; title: string; recordId: number; savedAt: string; pattern: string; recordLabel?: string | null; number?: string | null }): string {
  const label = input.recordLabel?.trim() ?? "";
  if (label && label !== input.title.trim()) return label;
  const date = input.savedAt.slice(0, 10);
  const formId = input.formId.trim();
  const token = (input.number ?? "").trim();
  if (formId) return filedRecordName(formId, token, date, input.pattern);
  const title = input.title.trim() || "Form";
  return token ? `${title}_${token}_${date}` : `${title}_${date}`;
}

/**
 * First exact label match wins. `fallback` catches records on a shared table
 * that are not one of the more specific blanks (ordinary NCRs, for example).
 */
export function formKeyForSharedTitle(matches: { formKey: string; match: string }[], value: string, fallback: string | null): string | null {
  const hit = matches.find((item) => item.match === value);
  return hit?.formKey ?? fallback;
}

/**
 * A controlled document number such as FRM-VAL-010. An empty id is not one.
 * A lowercase key such as frm-fai-001 is not one either: that is the internal
 * id, and it must not keep two copies of the same form apart.
 */
export function isRealFormNumber(formId: string): boolean {
  return /^[A-Z]{2,6}-[A-Z0-9]+-\d{2,4}$/.test(formId.trim());
}

/**
 * Title used to decide that two sources are the same form.
 * Case and extra spaces drop out. A trailing acronym such as (ECR) drops out.
 * An internal key such as (first_article_inspection) or (frm-fai-001) drops out.
 * A real form number such as (FRM-VAL-010) stays, so it cannot glue two forms together.
 */
export function cleanFormFolderTitle(title: string): string {
  let name = title.trim().replace(/\s+/g, " ");
  for (let pass = 0; pass < 2; pass += 1) {
    const next = name.replace(/\s*\(([^)]+)\)\s*$/, (whole, inner: string) => {
      const token = inner.trim();
      if (isRealFormNumber(token)) return whole;
      if (/^[A-Za-z]{2,8}$/.test(token)) return "";
      if (/^[a-z0-9]+(?:[_-][a-z0-9]+)+$/i.test(token)) return "";
      return whole;
    });
    if (next === name) break;
    name = next.trim();
  }
  return name.replace(/\s+/g, " ").trim();
}

export function formFolderMatchKey(title: string): string {
  return cleanFormFolderTitle(title).toLowerCase();
}

function isShouting(name: string): boolean {
  const letters = name.replace(/[^A-Za-z]/g, "");
  return letters.length > 0 && letters === letters.toUpperCase();
}

/** Prefer a readable mixed-case title over an all-caps import of the same words. */
export function preferredFormFolderName(titles: string[]): string {
  const cleaned = titles.map((title) => cleanFormFolderTitle(title)).filter((title) => title.length > 0);
  const quiet = cleaned.find((title) => !isShouting(title));
  return quiet ?? cleaned[0] ?? "Form";
}

interface GroupMember {
  formKey: string;
  title: string;
  formId: string;
  realNumber: string | null;
}

function finishFormFolderGroup(members: GroupMember[], distinguish: boolean, formId: string): Omit<FormFolderSummary, "savedCount"> {
  const formKeys = [...new Set(members.map((member) => member.formKey))].sort((a, b) => a.localeCompare(b));
  const numbered = members.find((member) => member.realNumber === formId);
  const formKey = (distinguish ? numbered?.formKey : members.find((member) => member.realNumber)?.formKey) ?? formKeys[0]!;
  const title = preferredFormFolderName(members.map((member) => member.title));
  const name = distinguish && formId ? `${title} (${formId})` : title;
  return { formKey, formKeys, title, formId: distinguish ? formId : (members.find((member) => member.realNumber)?.realNumber ?? ""), name };
}

/**
 * One Folders row per form name.
 * A module form and a blank template for the same form become one row.
 * Two blanks that carry different document numbers stay two rows.
 */
export function formFolderIndex(templates: FolderTemplate[]): Omit<FormFolderSummary, "savedCount">[] {
  const live = templates.filter(
    (template) => !RETIRED_FORM_FOLDER_KEYS.has(template.formKey) && (template.start != null || FILEABLE_FORM_KEYS.has(template.formKey)),
  );
  const buckets = new Map<string, GroupMember[]>();
  for (const template of live) {
    const title = template.title.trim() || template.formKey;
    const realNumber = isRealFormNumber(template.formId) ? template.formId.trim().toUpperCase() : null;
    const key = formFolderMatchKey(title);
    const list = buckets.get(key) ?? [];
    list.push({ formKey: template.formKey, title, formId: template.formId.trim(), realNumber });
    buckets.set(key, list);
  }

  const groups: Omit<FormFolderSummary, "savedCount">[] = [];
  for (const members of buckets.values()) {
    const numbers = [...new Set(members.map((member) => member.realNumber).filter((number): number is string => number != null))].sort();
    if (numbers.length >= 2) {
      for (const number of numbers) {
        groups.push(finishFormFolderGroup(members.filter((member) => member.realNumber === number), true, number));
      }
      const plain = members.filter((member) => member.realNumber == null);
      if (plain.length > 0) groups.push(finishFormFolderGroup(plain, false, ""));
    } else {
      groups.push(finishFormFolderGroup(members, false, numbers[0] ?? ""));
    }
  }
  return groups.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.formKey.localeCompare(b.formKey));
}

/** Saved copies from every source in the folder, newest first. */
export function combinedSavedFills(fills: Map<string, SavedFill[]>, formKeys: readonly string[]): SavedFill[] {
  return sortSavedFills(formKeys.flatMap((key) => fills.get(key) ?? []));
}

function bodyString(seed: FormTemplateSeed, key: string): string | null {
  const value = seed.start?.body[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function qmsFormType(seed: FormTemplateSeed): string | null {
  if (seed.start?.createPath !== "/qms-forms") return null;
  return bodyString(seed, "formType");
}

function pushModuleFill(bucket: Map<string, SavedFill[]>, templates: Map<string, { title: string; formId: string }>, seeds: Map<string, FormTemplateSeed>, formKey: string, row: Stamp) {
  if (FILEABLE_FORM_KEYS.has(formKey)) return;
  if (row.saved === false) return;
  const list = bucket.get(formKey);
  const template = templates.get(formKey);
  const seed = seeds.get(formKey);
  const openPath = seed?.start?.openPath.replaceAll("{id}", String(row.id));
  if (!list || !template || !seed || !openPath) return;
  const savedAt = isoStamp(row.updatedAt, row.createdAt);
  list.push({
    recordId: row.id,
    fileName: savedFillFileName({
      formId: (row.formNumber ?? template.formId).trim(),
      title: template.title,
      recordId: row.id,
      savedAt,
      pattern: fileNamePatternFor(seed),
      recordLabel: row.label,
      number: row.number ?? "",
    }),
    savedAt,
    openPath,
    documentsFolderId: null,
  });
}

interface SharedGroup {
  /** Key in the row map. Several form folders can share that table. */
  source: string;
  keys: string[];
  field: "title" | "name";
  fallback: string | null;
}

const SHARED_GROUPS: SharedGroup[] = [
  { source: "ncr", keys: ["supplier-ncr", "complaint", "ncr"], field: "title", fallback: "ncr" },
  { source: "audit-plan", keys: ["audit-plan", "audit-report"], field: "name", fallback: null },
  { source: "cal-register", keys: ["cal-register", "cal-record"], field: "name", fallback: null },
  { source: "ecr", keys: ["ecr", "eco"], field: "title", fallback: null },
];

async function catalog(db: Db, performedBy?: number): Promise<{ folders: FormFolderSummary[]; fills: Map<string, SavedFill[]> }> {
  await repairSavedFormListings(db, performedBy);
  const { templates } = await listFormTemplates(db);
  const index = formFolderIndex(templates);
  const fills = new Map<string, SavedFill[]>(index.flatMap((folder) => folder.formKeys.map((key) => [key, [] as SavedFill[]])));
  const templateByKey = new Map(templates.map((template) => [template.formKey, { title: template.title, formId: template.formId }]));
  const seeds = new Map(FORM_TEMPLATES.map((seed) => [seed.formKey, seed]));

  const pinRows = await db.select({ formKey: formFilings.formKey, recordId: formFilings.recordId, folderNodeId: formFilings.folderNodeId }).from(formFilings);
  const filedModule = new Set(pinRows.filter((row) => row.folderNodeId != null).map((row) => `${row.formKey}:${row.recordId}`));
  const filedUnder = (keys: readonly string[], id: number) => keys.some((key) => filedModule.has(`${key}:${id}`));
  const pins = new Map<string, string>();
  const pinNamespace = (formKey: string): string | null => {
    for (const group of SHARED_GROUPS) {
      if (group.keys.includes(formKey)) return group.source;
    }
    if (formKey === "risk" || formKey === "training-record") return formKey;
    return null;
  };
  for (const pin of pinRows) {
    const namespace = pinNamespace(pin.formKey);
    if (!namespace) continue;
    const mapKey = `${namespace}:${pin.recordId}`;
    const current = pins.get(mapKey);
    // Listing can also file the shared table under its generic key. The specific form wins.
    if (!current || current === namespace) pins.set(mapKey, pin.formKey);
  }

  const filings = await filterLiveFilings(db, await db.select().from(formFilings).where(isNotNull(formFilings.folderNodeId)));
  const nodeIds = [...new Set(filings.map((row) => row.folderNodeId).filter((id): id is number => id != null))];
  const nodes =
    nodeIds.length === 0
      ? []
      : await db
          .select({
            id: documentFolders.id,
            name: documentFolders.name,
            parentId: documentFolders.parentId,
            linkedPath: documentFolders.linkedPath,
            createdAt: documentFolders.createdAt,
          })
          .from(documentFolders)
          .where(inArray(documentFolders.id, nodeIds));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  for (const filing of filings) {
    if (!FILEABLE_FORM_KEYS.has(filing.formKey) || filing.folderNodeId == null) continue;
    const list = fills.get(filing.formKey);
    const template = templateByKey.get(filing.formKey);
    const seed = seeds.get(filing.formKey);
    const node = nodeById.get(filing.folderNodeId);
    if (!list || !template || !seed || !node) continue;
    const savedAt = isoStamp(filing.updatedAt, node.createdAt ?? filing.createdAt);
    list.push({
      recordId: filing.recordId,
      fileName:
        node.name.trim() ||
        savedFillFileName({
          formId: template.formId,
          title: template.title,
          recordId: filing.recordId,
          savedAt,
          pattern: fileNamePatternFor(seed),
          number: "",
        }),
      savedAt,
      openPath: canonicalOpenPath(filing.formKey, filing.recordId),
      documentsFolderId: node.parentId,
    });
  }

  const qmsRows = await db
    .select({ id: qmsForms.id, formType: qmsForms.formType, formNo: qmsForms.formNo, createdAt: qmsForms.createdAt, updatedAt: qmsForms.updatedAt })
    .from(qmsForms);
  for (const seed of FORM_TEMPLATES) {
    const formType = qmsFormType(seed);
    if (!formType || !fills.has(seed.formKey)) continue;
    for (const row of qmsRows) {
      if (row.formType !== formType) continue;
      pushModuleFill(fills, templateByKey, seeds, seed.formKey, {
        id: row.id,
        label: null,
        formNumber: null,
        number: row.formNo,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        saved: row.updatedAt != null,
      });
    }
  }

  const ncrRows = await db
    .select({ id: ncr.id, title: ncr.title, recordNumber: ncr.recordNumber, createdAt: ncr.createdAt, updatedAt: ncr.updatedAt })
    .from(ncr)
    .where(eq(ncr.isDeleted, false));
  const capaRows = await db.select({ id: capa.id, recordNumber: capa.recordNumber, createdAt: capa.createdAt, updatedAt: capa.updatedAt }).from(capa);
  const eightRows = await db.select({ id: eightD.id, recordNumber: eightD.recordNumber, createdAt: eightD.createdAt, updatedAt: eightD.updatedAt }).from(eightD);
  const dcrRows = await db
    .select({
      id: documentChangeRequests.id,
      formNo: documentChangeRequests.formNo,
      documentProcessName: documentChangeRequests.documentProcessName,
      createdAt: documentChangeRequests.createdAt,
      updatedAt: documentChangeRequests.updatedAt,
    })
    .from(documentChangeRequests);
  const riskRows = await db
    .select({ id: riskAssessments.id, title: riskAssessments.title, recordNumber: riskAssessments.recordNumber, createdAt: riskAssessments.createdAt, updatedAt: riskAssessments.updatedAt })
    .from(riskAssessments);
  const auditRows = await db.select({ id: audits.id, name: audits.name, recordNumber: audits.recordNumber, createdAt: audits.createdAt }).from(audits);
  const equipmentRows = await db.select({ id: equipment.id, name: equipment.name, createdAt: equipment.createdAt }).from(equipment);
  const trainingRows = await db
    .select({ id: trainingCourses.id, title: trainingCourses.title, createdAt: trainingCourses.createdAt, updatedAt: trainingCourses.updatedAt })
    .from(trainingCourses);
  const changeRows = await db
    .select({ id: changeRequests.id, title: changeRequests.title, recordNumber: changeRequests.recordNumber, createdAt: changeRequests.createdAt, updatedAt: changeRequests.updatedAt })
    .from(changeRequests);

  const rowsFor = new Map<string, Stamp[]>([
    ["ncr", ncrRows.map((row) => ({ id: row.id, label: row.title, formNumber: null, number: row.recordNumber, createdAt: row.createdAt, updatedAt: row.updatedAt, saved: row.updatedAt != null }))],
    ["capa", capaRows.map((row) => ({ id: row.id, label: null, formNumber: null, number: row.recordNumber, createdAt: row.createdAt, updatedAt: row.updatedAt, saved: row.updatedAt != null }))],
    ["8d", eightRows.map((row) => ({ id: row.id, label: null, formNumber: null, number: row.recordNumber, createdAt: row.createdAt, updatedAt: row.updatedAt, saved: row.updatedAt != null }))],
    [
      "dcr",
      dcrRows.map((row) => ({
        id: row.id,
        label: row.documentProcessName,
        formNumber: null,
        number: row.formNo,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        saved: row.updatedAt != null,
      })),
    ],
    ["risk", riskRows.map((row) => ({ id: row.id, label: row.title, formNumber: null, number: row.recordNumber, createdAt: row.createdAt, updatedAt: row.updatedAt, saved: row.updatedAt != null }))],
    ["audit-plan", auditRows.map((row) => ({ id: row.id, label: row.name, formNumber: null, number: row.recordNumber, createdAt: row.createdAt, updatedAt: null, saved: filedUnder(["audit-plan", "audit-report"], row.id) }))],
    ["cal-register", equipmentRows.map((row) => ({ id: row.id, label: row.name, formNumber: null, number: "", createdAt: row.createdAt, updatedAt: null, saved: filedUnder(["cal-register", "cal-record"], row.id) }))],
    ["training-record", trainingRows.map((row) => ({ id: row.id, label: row.title, formNumber: null, number: "", createdAt: row.createdAt, updatedAt: row.updatedAt, saved: row.updatedAt != null }))],
    ["ecr", changeRows.map((row) => ({ id: row.id, label: row.title, formNumber: null, number: row.recordNumber, createdAt: row.createdAt, updatedAt: row.updatedAt, saved: row.updatedAt != null }))],
  ]);

  for (const group of SHARED_GROUPS) {
    const rows = rowsFor.get(group.source) ?? [];
    const matches = group.keys
      .map((formKey) => {
        const seed = seeds.get(formKey);
        const match = seed ? bodyString(seed, group.field) : null;
        return match ? { formKey, match } : null;
      })
      .filter((item): item is { formKey: string; match: string } => item != null);
    for (const row of rows) {
      const pinned = pins.get(`${group.source}:${row.id}`);
      const formKey = pinned && group.keys.includes(pinned) ? pinned : formKeyForSharedTitle(matches, row.label ?? "", group.fallback);
      if (!formKey) continue;
      if (pinned && pinned !== formKey) continue;
      pushModuleFill(fills, templateByKey, seeds, formKey, row);
    }
  }

  for (const formKey of ["capa", "8d", "dcr"] as const) {
    for (const row of rowsFor.get(formKey) ?? []) pushModuleFill(fills, templateByKey, seeds, formKey, row);
  }

  for (const formKey of ["risk", "training-record"] as const) {
    const seed = seeds.get(formKey);
    const match = seed ? bodyString(seed, "title") : null;
    if (!match) continue;
    for (const row of rowsFor.get(formKey) ?? []) {
      const pinned = pins.get(`${formKey}:${row.id}`);
      if (pinned) {
        if (pinned === formKey) pushModuleFill(fills, templateByKey, seeds, formKey, row);
        continue;
      }
      if ((row.label ?? "") !== match) continue;
      pushModuleFill(fills, templateByKey, seeds, formKey, row);
    }
  }

  const combined = new Map<string, SavedFill[]>();
  for (const folder of index) {
    const rows = combinedSavedFills(fills, folder.formKeys);
    combined.set(folder.formKey, rows);
    for (const key of folder.formKeys) combined.set(key, rows);
  }

  return {
    folders: index.map((folder) => ({ ...folder, savedCount: combined.get(folder.formKey)?.length ?? 0 })),
    fills: combined,
  };
}

async function folderProfile(db: Db) {
  const [row] = await db.select({ profile: company.profile }).from(company).limit(1);
  return row?.profile ?? {};
}

function hiddenFormFolder(formKeys: readonly string[], deleted: ReadonlySet<string>): boolean {
  return formKeys.some((key) => deleted.has(key));
}

function withAlias<T extends { formKey: string; formKeys: string[]; name: string }>(folder: T, aliases: Record<string, string> | undefined): T {
  const alias = folder.formKeys.map((key) => aliases?.[key]).find((name) => name && name.trim()) ?? aliases?.[folder.formKey];
  if (!alias?.trim()) return folder;
  return { ...folder, name: alias.trim().replace(/\s+/g, " ") };
}

export async function listFormFolders(db: Db, performedBy?: number): Promise<FormFolderSummary[]> {
  const { folders } = await catalog(db, performedBy);
  const profile = await folderProfile(db);
  const deleted = new Set(profile.deletedFormFolderKeys ?? []);
  return folders.filter((folder) => !hiddenFormFolder(folder.formKeys, deleted)).map((folder) => withAlias(folder, profile.formFolderDisplayNames));
}

export async function getFormFolder(db: Db, formKey: string, performedBy?: number): Promise<FormFolderDetail> {
  const key = formKey.trim();
  if (!key) throw AppError.badRequest("Form is required");
  const { folders, fills } = await catalog(db, performedBy);
  const profile = await folderProfile(db);
  const deleted = new Set(profile.deletedFormFolderKeys ?? []);
  const found = folders.find((item) => item.formKey === key || item.formKeys.includes(key));
  if (!found || hiddenFormFolder(found.formKeys, deleted)) throw AppError.notFound("Form folder");
  const folder = withAlias(found, profile.formFolderDisplayNames);
  return {
    formKey: folder.formKey,
    formKeys: folder.formKeys,
    title: folder.title,
    formId: folder.formId,
    name: folder.name,
    fills: fills.get(folder.formKey) ?? [],
  };
}

function sameFolderName(left: string, right: string): boolean {
  return folderIdentityKey(left) === folderIdentityKey(right);
}

export async function renameFormFolder(db: Db, formKey: string, name: string, performedBy?: number): Promise<FormFolderSummary> {
  const next = name.trim().replace(/\s+/g, " ");
  if (!next) throw AppError.badRequest("Folder name is required");
  const folders = await listFormFolders(db, performedBy);
  const folder = folders.find((item) => item.formKey === formKey || item.formKeys.includes(formKey));
  if (!folder) throw AppError.notFound("Form folder");
  if (folders.some((item) => item.formKey !== folder.formKey && sameFolderName(item.name, next))) {
    throw AppError.badRequest("A folder with that name is already here.");
  }
  const previous = folder.name;
  if (previous !== next) {
    await rememberFormFolderName(db, folder.formKeys, next);
    const [template] = await db.select({ id: controlledFormTemplates.id }).from(controlledFormTemplates).where(eq(controlledFormTemplates.formKey, folder.formKey));
    await recordAuditTrail(db, {
      entityType: "FormFolder",
      entityId: template?.id ?? 0,
      action: "update",
      performedBy,
      changes: {
        event: "renamed",
        summary: `Renamed the folder from "${previous}" to "${next}".`,
        from: previous,
        to: next,
        formKeys: folder.formKeys,
      },
    });
  }
  return { ...folder, name: next };
}

export async function retireFormFolder(db: Db, formKey: string, destinationId: number | null, performedBy?: number): Promise<void> {
  const detail = await getFormFolder(db, formKey, performedBy);
  if (detail.fills.length > 0) {
    if (destinationId == null) throw AppError.badRequest("Choose a folder for the saved forms.");
    const all = await db.select().from(documentFolders);
    const destination = all.find((folder) => folder.id === destinationId);
    if (!destination) throw AppError.notFound("Destination folder");
    if (folderIsBlankLibrary(all, destination.id)) {
      throw AppError.badRequest("Blank Forms Templates holds empty blanks. Pick another folder for the saved forms.");
    }
    const filings = await db.select().from(formFilings).where(inArray(formFilings.formKey, [...detail.formKeys]));
    const filingByRecord = new Map(filings.map((row) => [`${row.formKey}:${row.recordId}`, row]));
    let sortOrder = all.filter((folder) => folder.parentId === destination.id).length;
    for (const fill of detail.fills) {
      const filing = detail.formKeys.map((key) => filingByRecord.get(`${key}:${fill.recordId}`)).find((row) => row);
      const node = filing?.folderNodeId == null ? undefined : all.find((folder) => folder.id === filing.folderNodeId);
      if (node) {
        if (node.parentId === destination.id) continue;
        const fromParentId = node.parentId;
        const fromLabel = folderLocationLabel(all, fromParentId);
        const toLabel = folderLocationLabel(all, destination.id);
        await db.update(documentFolders).set({ parentId: destination.id, updatedAt: new Date() }).where(eq(documentFolders.id, node.id));
        node.parentId = destination.id;
        await recordAuditTrail(db, {
          entityType: "DocumentFolder",
          entityId: node.id,
          action: "update",
          performedBy,
          changes: {
            event: "moved",
            summary: `Moved the saved form "${node.name}" from ${fromLabel} → ${toLabel}.`,
            name: node.name,
            from: fromLabel,
            to: toLabel,
            fromParentId,
            toParentId: destination.id,
          },
        });
        continue;
      }
      const [created] = await db
        .insert(documentFolders)
        .values({ name: fill.fileName, parentId: destination.id, sortOrder, linkedPath: fill.openPath })
        .returning();
      sortOrder += 1;
      if (created && filing) {
        await db.update(formFilings).set({ folderNodeId: created.id, updatedAt: new Date() }).where(eq(formFilings.id, filing.id));
      }
      if (created) {
        await recordAuditTrail(db, {
          entityType: "DocumentFolder",
          entityId: created.id,
          action: "update",
          performedBy,
          changes: {
            event: "moved",
            summary: `Moved the saved form "${fill.fileName}" into ${folderLocationLabel(all, destination.id)}.`,
            name: fill.fileName,
            to: folderLocationLabel(all, destination.id),
            toParentId: destination.id,
          },
        });
      }
    }
  }
  await rememberDeletedFormFolders(db, detail.formKeys);
  const [template] = await db.select({ id: controlledFormTemplates.id }).from(controlledFormTemplates).where(eq(controlledFormTemplates.formKey, detail.formKey));
  await recordAuditTrail(db, {
    entityType: "FormFolder",
    entityId: template?.id ?? 0,
    action: "delete",
    performedBy,
    changes: {
      event: "deleted",
      name: detail.name,
      summary:
        detail.fills.length > 0
          ? `Deleted the folder "${detail.name}" after moving ${detail.fills.length} saved form${detail.fills.length === 1 ? "" : "s"}. It will not be created again.`
          : `Deleted the folder "${detail.name}". It was empty, and it will not be created again.`,
      formKeys: detail.formKeys,
      destinationId,
    },
  });
}

/** Finds or creates the document folder that holds copies saved into this form's folder. */
export async function ensureSavedFormFolder(db: Db, formKey: string, performedBy?: number, requestedKey?: string): Promise<number> {
  const key = formKey.trim();
  const folders = await listFormFolders(db, performedBy);
  const folder = folders.find((item) => item.formKey === key || item.formKeys.includes(key));
  if (!folder) throw AppError.badRequest("That form does not have a folder. Pick a Documents folder.");
  if (requestedKey) {
    const requested = requestedKey.trim();
    if (requested !== folder.formKey && !folder.formKeys.includes(requested)) {
      throw AppError.badRequest("That folder is for a different form.");
    }
  }

  const all = await db.select().from(documentFolders);
  const iso = all.find((row) => row.parentId == null && row.name === ISO_DOCUMENTS_FOLDER);
  if (!iso) throw AppError.notFound("ISO Compliance Documents");

  let root = all.find((row) => row.parentId === iso.id && row.name === SAVED_FORM_FOLDERS_ROOT);
  if (!root) {
    const siblings = all.filter((row) => row.parentId === iso.id);
    const [created] = await db.insert(documentFolders).values({ name: SAVED_FORM_FOLDERS_ROOT, parentId: iso.id, sortOrder: siblings.length }).returning();
    if (!created) throw new AppError("Failed to file this form", 500);
    root = created;
    all.push(created);
    await recordAuditTrail(db, {
      entityType: "DocumentFolder",
      entityId: created.id,
      action: "create",
      performedBy,
      changes: {
        event: "created",
        summary: `Created the folder "${SAVED_FORM_FOLDERS_ROOT}" under ${ISO_DOCUMENTS_FOLDER}.`,
        name: SAVED_FORM_FOLDERS_ROOT,
        parentId: iso.id,
      },
    });
  }

  const marker = `/form-folders/${folder.formKey}`;
  const child = all.find((row) => row.parentId === root.id && row.linkedPath === marker);
  if (child) return child.id;

  const siblings = all.filter((row) => row.parentId === root.id);
  const [created] = await db
    .insert(documentFolders)
    .values({ name: folder.name, parentId: root.id, sortOrder: siblings.length, linkedPath: marker })
    .returning();
  if (!created) throw new AppError("Failed to file this form", 500);
  await recordAuditTrail(db, {
    entityType: "DocumentFolder",
    entityId: created.id,
    action: "create",
    performedBy,
    changes: {
      event: "created",
      summary: `Created the folder "${folder.name}" for saved copies of that form.`,
      name: folder.name,
      parentId: root.id,
      formKeys: folder.formKeys,
      linkedPath: marker,
    },
  });
  return created.id;
}
