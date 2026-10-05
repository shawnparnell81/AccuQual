import { eq, inArray, isNotNull } from "drizzle-orm";
import { audits } from "../../drizzle/schema/audits.js";
import { capa } from "../../drizzle/schema/capa.js";
import { equipment } from "../../drizzle/schema/calibration.js";
import { changeRequests } from "../../drizzle/schema/change.js";
import { documentChangeRequests } from "../../drizzle/schema/documentChangeRequests.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import { eightD } from "../../drizzle/schema/eightD.js";
import { formFilings } from "../../drizzle/schema/formFilings.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { qmsForms } from "../../drizzle/schema/qmsForms.js";
import { riskAssessments } from "../../drizzle/schema/risk.js";
import { trainingCourses } from "../../drizzle/schema/training.js";
import type { Db } from "../../lib/requestDb.js";
import { AppError } from "../../utils/appError.js";
import { FILEABLE_FORM_KEYS, recordLinkedPath } from "./editableForms.js";
import { FORM_TEMPLATES, filedRecordName, fileNamePatternFor, type FormTemplateSeed } from "./formFiling.js";
import { listFormTemplates } from "./formTemplates.js";

/**
 * One Folders row per fillable form. The name is the blank / QMS title.
 * Saved copies are listed separately. A blank template is not a saved file.
 */
export interface FormFolderSummary {
  formKey: string;
  /** Blank or QMS title. */
  title: string;
  formId: string;
  /** Title, with the form number when two forms share a title. */
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
  createdAt: Date | null;
  updatedAt: Date | null;
}

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
export function savedFillFileName(input: { formId: string; title: string; recordId: number; savedAt: string; pattern: string; recordLabel?: string | null }): string {
  const label = input.recordLabel?.trim() ?? "";
  if (label && label !== input.title.trim()) return label;
  const date = input.savedAt.slice(0, 10);
  const formId = input.formId.trim();
  if (formId) return filedRecordName(formId, input.recordId, date, input.pattern);
  const title = input.title.trim() || "Form";
  return `${title}_${input.recordId}_${date}`;
}

/**
 * First exact label match wins. `fallback` catches records on a shared table
 * that are not one of the more specific blanks (ordinary NCRs, for example).
 */
export function formKeyForSharedTitle(matches: { formKey: string; match: string }[], value: string, fallback: string | null): string | null {
  const hit = matches.find((item) => item.match === value);
  return hit?.formKey ?? fallback;
}

/** Folders for every form that can be filled or saved. Registers that are not blanks stay out. */
export function formFolderIndex(templates: FolderTemplate[]): Omit<FormFolderSummary, "savedCount">[] {
  const live = templates.filter((template) => template.start != null || FILEABLE_FORM_KEYS.has(template.formKey));
  const titleCount = new Map<string, number>();
  for (const template of live) {
    const title = template.title.trim() || template.formKey;
    titleCount.set(title, (titleCount.get(title) ?? 0) + 1);
  }
  return live
    .map((template) => {
      const title = template.title.trim() || template.formKey;
      const formId = template.formId.trim();
      const shared = (titleCount.get(title) ?? 0) > 1;
      const name = shared ? (formId ? `${title} (${formId})` : `${title} (${template.formKey})`) : title;
      return { formKey: template.formKey, title, formId, name };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.formKey.localeCompare(b.formKey));
}

function bodyString(seed: FormTemplateSeed, key: string): string | null {
  const value = seed.start?.body[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function qmsFormType(seed: FormTemplateSeed): string | null {
  if (seed.start?.createPath !== "/qms-forms") return null;
  return bodyString(seed, "formType");
}

/** A module home is not a saved file. `/pareto` is the one filed chart. */
function isRecordPath(linkedPath: string): boolean {
  if (linkedPath === "/pareto") return true;
  return /\/\d+(?:\/|$)/.test(linkedPath);
}

function pushModuleFill(bucket: Map<string, SavedFill[]>, templates: Map<string, { title: string; formId: string }>, seeds: Map<string, FormTemplateSeed>, formKey: string, row: Stamp) {
  if (FILEABLE_FORM_KEYS.has(formKey)) return;
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

async function catalog(db: Db): Promise<{ folders: FormFolderSummary[]; fills: Map<string, SavedFill[]> }> {
  const { templates } = await listFormTemplates(db);
  const index = formFolderIndex(templates);
  const fills = new Map<string, SavedFill[]>(index.map((folder) => [folder.formKey, []]));
  const templateByKey = new Map(templates.map((template) => [template.formKey, { title: template.title, formId: template.formId }]));
  const seeds = new Map(FORM_TEMPLATES.map((seed) => [seed.formKey, seed]));

  const filings = await db.select().from(formFilings).where(isNotNull(formFilings.folderNodeId));
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
    const linked = node.linkedPath;
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
        }),
      savedAt,
      openPath: linked && isRecordPath(linked) ? linked : recordLinkedPath(filing.formKey, filing.recordId),
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
        formNumber: row.formNo,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }
  }

  const ncrRows = await db
    .select({ id: ncr.id, title: ncr.title, createdAt: ncr.createdAt, updatedAt: ncr.updatedAt })
    .from(ncr)
    .where(eq(ncr.isDeleted, false));
  const capaRows = await db.select({ id: capa.id, createdAt: capa.createdAt, updatedAt: capa.updatedAt }).from(capa);
  const eightRows = await db.select({ id: eightD.id, createdAt: eightD.createdAt, updatedAt: eightD.updatedAt }).from(eightD);
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
    .select({ id: riskAssessments.id, title: riskAssessments.title, createdAt: riskAssessments.createdAt, updatedAt: riskAssessments.updatedAt })
    .from(riskAssessments);
  const auditRows = await db.select({ id: audits.id, name: audits.name, createdAt: audits.createdAt }).from(audits);
  const equipmentRows = await db.select({ id: equipment.id, name: equipment.name, createdAt: equipment.createdAt }).from(equipment);
  const trainingRows = await db
    .select({ id: trainingCourses.id, title: trainingCourses.title, createdAt: trainingCourses.createdAt, updatedAt: trainingCourses.updatedAt })
    .from(trainingCourses);
  const changeRows = await db
    .select({ id: changeRequests.id, title: changeRequests.title, createdAt: changeRequests.createdAt, updatedAt: changeRequests.updatedAt })
    .from(changeRequests);

  const rowsFor = new Map<string, Stamp[]>([
    ["ncr", ncrRows.map((row) => ({ id: row.id, label: row.title, formNumber: null, createdAt: row.createdAt, updatedAt: row.updatedAt }))],
    ["capa", capaRows.map((row) => ({ id: row.id, label: null, formNumber: null, createdAt: row.createdAt, updatedAt: row.updatedAt }))],
    ["8d", eightRows.map((row) => ({ id: row.id, label: null, formNumber: null, createdAt: row.createdAt, updatedAt: row.updatedAt }))],
    [
      "dcr",
      dcrRows.map((row) => ({
        id: row.id,
        label: row.documentProcessName,
        formNumber: row.formNo,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    ],
    ["risk", riskRows.map((row) => ({ id: row.id, label: row.title, formNumber: null, createdAt: row.createdAt, updatedAt: row.updatedAt }))],
    ["audit-plan", auditRows.map((row) => ({ id: row.id, label: row.name, formNumber: null, createdAt: row.createdAt, updatedAt: null }))],
    ["cal-register", equipmentRows.map((row) => ({ id: row.id, label: row.name, formNumber: null, createdAt: row.createdAt, updatedAt: null }))],
    ["training-record", trainingRows.map((row) => ({ id: row.id, label: row.title, formNumber: null, createdAt: row.createdAt, updatedAt: row.updatedAt }))],
    ["ecr", changeRows.map((row) => ({ id: row.id, label: row.title, formNumber: null, createdAt: row.createdAt, updatedAt: row.updatedAt }))],
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
      const formKey = formKeyForSharedTitle(matches, row.label ?? "", group.fallback);
      if (!formKey) continue;
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
      if ((row.label ?? "") !== match) continue;
      pushModuleFill(fills, templateByKey, seeds, formKey, row);
    }
  }

  for (const list of fills.values()) list.sort(compareSavedFills);

  return {
    folders: index.map((folder) => ({ ...folder, savedCount: fills.get(folder.formKey)?.length ?? 0 })),
    fills,
  };
}

export async function listFormFolders(db: Db): Promise<FormFolderSummary[]> {
  const { folders } = await catalog(db);
  return folders;
}

export async function getFormFolder(db: Db, formKey: string): Promise<FormFolderDetail> {
  const key = formKey.trim();
  if (!key) throw AppError.badRequest("Form is required");
  const { folders, fills } = await catalog(db);
  const folder = folders.find((item) => item.formKey === key);
  if (!folder) throw AppError.notFound("Form folder");
  return {
    formKey: folder.formKey,
    title: folder.title,
    formId: folder.formId,
    name: folder.name,
    fills: fills.get(folder.formKey) ?? [],
  };
}
