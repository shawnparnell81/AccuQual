import { and, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { audits, auditItems } from "../../drizzle/schema/audits.js";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import { capa } from "../../drizzle/schema/capa.js";
import { equipment } from "../../drizzle/schema/calibration.js";
import { changeRequests } from "../../drizzle/schema/change.js";
import { documentChangeRequests } from "../../drizzle/schema/documentChangeRequests.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import { eightD } from "../../drizzle/schema/eightD.js";
import { formData } from "../../drizzle/schema/forms.js";
import { formFilings } from "../../drizzle/schema/formFilings.js";
import { isoQualityForms } from "../../drizzle/schema/isoQualityForms.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { qmsForms } from "../../drizzle/schema/qmsForms.js";
import { riskAssessments } from "../../drizzle/schema/risk.js";
import { trainingCourses } from "../../drizzle/schema/training.js";
import { validationReports } from "../../drizzle/schema/validationReport.js";
import type { Db } from "../../lib/requestDb.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { shouldRepairFiledLink } from "../forms/formEditAudit.js";
import { FILEABLE_FORM_KEYS, ISO_TYPE_TO_FORM_KEY, recordLinkedPath, validationFormKeyFor } from "./editableForms.js";
import { FILE_NAME_PATTERN, FORM_TEMPLATES, ISO_DOCUMENTS_FOLDER, auditRecordKept, blankFormKeyForCreate, fileNamePatternFor, moduleRecordKept, savedFillFileName } from "./formFiling.js";
import { ensureFormTemplates } from "./formTemplates.js";
import { rememberSavedListingStamp, skipSavedListingRepair } from "./listingRepairGate.js";

/**
 * Saved forms must open the record that was filed. Listing and search run this
 * again. They rewrite a link that is already wrong, hide a file whose record
 * is already gone, and file a saved record that is missing its folder copy.
 * A copy the user has not saved is taken out of its folder. The record stays
 * until it is a day old. A saved copy is not deleted. No migration: the same
 * pass is safe to run more than once.
 */

/** Same folder name as formFolders.SAVED_FORM_FOLDERS_ROOT. Kept here so this file does not import that module. */
const SAVED_FORM_FOLDERS_ROOT = "Saved Form Folders";

/** First Article folders are retired. Do not file those records back into a folder. */
const RETIRED_FORM_KEYS = new Set(["frm-fai-001", "first_article_inspection"]);

const FOLDER_AUDIT = "DocumentFolder";

type RecordKind =
  | "validation"
  | "iso"
  | "qms"
  | "equipment"
  | "ncr"
  | "capa"
  | "eight_d"
  | "dcr"
  | "risk"
  | "audit"
  | "training"
  | "change";

const PATH_RULES: { re: RegExp; kind: RecordKind }[] = [
  { re: /^\/validation-reports\/(\d+)$/, kind: "validation" },
  { re: /^\/iso-forms\/record\/(\d+)$/, kind: "iso" },
  { re: /^\/qms-forms\/[^/]+\/(\d+)$/, kind: "qms" },
  { re: /^\/calibration\/(\d+)$/, kind: "equipment" },
  { re: /^\/ncr\/(\d+)$/, kind: "ncr" },
  { re: /^\/capa\/(\d+)$/, kind: "capa" },
  { re: /^\/8d\/(\d+)$/, kind: "eight_d" },
  { re: /^\/document-change-requests\/(\d+)$/, kind: "dcr" },
  { re: /^\/risk\/(\d+)$/, kind: "risk" },
  { re: /^\/audits\/(\d+)$/, kind: "audit" },
  { re: /^\/training\/(\d+)$/, kind: "training" },
  { re: /^\/change\/(\d+)$/, kind: "change" },
];

const MODULE_KIND: Record<string, RecordKind> = {
  ncr: "ncr",
  "supplier-ncr": "ncr",
  complaint: "ncr",
  capa: "capa",
  "8d": "eight_d",
  dcr: "dcr",
  risk: "risk",
  "audit-plan": "audit",
  "audit-report": "audit",
  "cal-register": "equipment",
  "cal-record": "equipment",
  "frm-msa-001": "equipment",
  "training-record": "training",
  ecr: "change",
  eco: "change",
};

function pathOnly(linkedPath: string | null | undefined): string {
  if (!linkedPath) return "";
  return linkedPath.split("?")[0] ?? linkedPath;
}

export function parseRecordLink(linkedPath: string | null | undefined): { kind: RecordKind; id: number } | null {
  const path = pathOnly(linkedPath);
  for (const rule of PATH_RULES) {
    const match = path.match(rule.re);
    if (!match?.[1]) continue;
    return { kind: rule.kind, id: Number(match[1]) };
  }
  return null;
}

function qmsFormKeys(): Set<string> {
  return new Set(FORM_TEMPLATES.filter((seed) => seed.start?.createPath === "/qms-forms").map((seed) => seed.formKey));
}

function kindForFormKey(formKey: string): RecordKind | "page" | null {
  if (formKey === "frm-par-001") return "page";
  const named = MODULE_KIND[formKey];
  if (named) return named;
  if (formKey.startsWith("frm-val-")) return "validation";
  if (qmsFormKeys().has(formKey)) return "qms";
  if (FILEABLE_FORM_KEYS.has(formKey)) return "iso";
  return null;
}

/** The address a saved copy opens. The blank's own pattern wins over a path stored on the folder. */
export function canonicalOpenPath(formKey: string, recordId: number): string {
  const seed = FORM_TEMPLATES.find((item) => item.formKey === formKey);
  if (seed?.start?.openPath.includes("{id}")) return seed.start.openPath.replaceAll("{id}", String(recordId));
  return recordLinkedPath(formKey, recordId);
}

function aliveKey(kind: RecordKind, id: number): string {
  return `${kind}:${id}`;
}

async function idsOf(db: Db, kind: RecordKind, ids: number[]): Promise<Set<number>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Set();
  const rows = await (async () => {
    switch (kind) {
      case "validation":
        return db.select({ id: validationReports.id }).from(validationReports).where(inArray(validationReports.id, unique));
      case "iso":
        return db.select({ id: isoQualityForms.id }).from(isoQualityForms).where(inArray(isoQualityForms.id, unique));
      case "qms":
        return db.select({ id: qmsForms.id }).from(qmsForms).where(inArray(qmsForms.id, unique));
      case "equipment":
        return db.select({ id: equipment.id }).from(equipment).where(inArray(equipment.id, unique));
      case "ncr":
        return db.select({ id: ncr.id }).from(ncr).where(and(inArray(ncr.id, unique), eq(ncr.isDeleted, false)));
      case "capa":
        return db.select({ id: capa.id }).from(capa).where(inArray(capa.id, unique));
      case "eight_d":
        return db.select({ id: eightD.id }).from(eightD).where(inArray(eightD.id, unique));
      case "dcr":
        return db.select({ id: documentChangeRequests.id }).from(documentChangeRequests).where(inArray(documentChangeRequests.id, unique));
      case "risk":
        return db.select({ id: riskAssessments.id }).from(riskAssessments).where(inArray(riskAssessments.id, unique));
      case "audit":
        return db.select({ id: audits.id }).from(audits).where(inArray(audits.id, unique));
      case "training":
        return db.select({ id: trainingCourses.id }).from(trainingCourses).where(inArray(trainingCourses.id, unique));
      case "change":
        return db.select({ id: changeRequests.id }).from(changeRequests).where(inArray(changeRequests.id, unique));
    }
  })();
  return new Set(rows.map((row) => row.id));
}

async function loadAlive(db: Db, wanted: Map<RecordKind, number[]>): Promise<Set<string>> {
  const alive = new Set<string>();
  // One request uses one database connection. These lookups have to take turns.
  for (const [kind, ids] of wanted) {
    const present = await idsOf(db, kind, ids);
    for (const id of present) alive.add(aliveKey(kind, id));
  }
  return alive;
}

function remember(wanted: Map<RecordKind, number[]>, kind: RecordKind, id: number) {
  const list = wanted.get(kind) ?? [];
  list.push(id);
  wanted.set(kind, list);
}

async function deleteExclusiveLeaf(db: Db, nodeId: number, performedBy: number | undefined) {
  const [node] = await db.select().from(documentFolders).where(eq(documentFolders.id, nodeId));
  if (!node || node.pdfPath || node.documentId != null) return;
  const [child] = await db.select({ id: documentFolders.id }).from(documentFolders).where(eq(documentFolders.parentId, nodeId)).limit(1);
  if (child) return;
  const [filing] = await db.select({ id: formFilings.id }).from(formFilings).where(eq(formFilings.folderNodeId, nodeId)).limit(1);
  if (filing) return;
  try {
    await db.delete(documentFolders).where(eq(documentFolders.id, nodeId));
  } catch {
    return;
  }
  await recordAuditTrail(db, {
    entityType: FOLDER_AUDIT,
    entityId: nodeId,
    action: "delete",
    changes: { event: "orphan_removed", name: node.name, linkedPath: node.linkedPath },
    performedBy,
  });
}

/** True when this filing's record is still in its table. Unknown keys stay visible. */
export async function filterLiveFilings<T extends { formKey: string; recordId: number }>(db: Db, filings: T[]): Promise<T[]> {
  const wanted = new Map<RecordKind, number[]>();
  for (const filing of filings) {
    const kind = kindForFormKey(filing.formKey);
    if (kind && kind !== "page") remember(wanted, kind, filing.recordId);
  }
  const alive = await loadAlive(db, wanted);
  return filings.filter((filing) => {
    const kind = kindForFormKey(filing.formKey);
    if (!kind || kind === "page") return true;
    return alive.has(aliveKey(kind, filing.recordId));
  });
}

interface SavedCopy {
  formKey: string;
  recordId: number;
  createdAt: Date | null;
  updatedAt: Date | null;
  recordNumber: string;
  /** Title or name, when the folder list uses that instead of the form number. */
  label: string | null;
  /** False until the user saves. Tables without a save time stay true. */
  userSaved: boolean;
}

function pushCopy(
  copies: SavedCopy[],
  formKey: string | null | undefined,
  recordId: number,
  createdAt: Date | null,
  recordNumber: string | null,
  userSaved = true,
  extra?: { label?: string | null; updatedAt?: Date | null },
) {
  if (!formKey || RETIRED_FORM_KEYS.has(formKey)) return;
  if (!Number.isInteger(recordId) || recordId < 1) return;
  copies.push({
    formKey,
    recordId,
    createdAt,
    updatedAt: extra?.updatedAt ?? null,
    recordNumber: recordNumber?.trim() ?? "",
    label: extra?.label?.trim() ? extra.label.trim() : null,
    userSaved,
  });
}

const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Drop ISO and validation blanks nobody saved, once they are a day old. A saved copy stays. */
export async function deleteExpiredUnsavedDrafts(db: Db, now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - DRAFT_MAX_AGE_MS);
  const staleIso = await db
    .select({ id: isoQualityForms.id, formType: isoQualityForms.formType })
    .from(isoQualityForms)
    .where(and(isNull(isoQualityForms.updatedAt), lt(isoQualityForms.createdAt, cutoff)));
  const staleValidation = await db
    .select({ id: validationReports.id, data: validationReports.data })
    .from(validationReports)
    .where(and(isNull(validationReports.updatedAt), lt(validationReports.createdAt, cutoff)));
  const pairs: { formKey: string; recordId: number }[] = [];
  for (const row of staleIso) {
    const formKey = ISO_TYPE_TO_FORM_KEY[row.formType];
    if (formKey) pairs.push({ formKey, recordId: row.id });
  }
  for (const row of staleValidation) {
    const formKey = validationFormKeyFor(row.data);
    if (formKey) pairs.push({ formKey, recordId: row.id });
  }
  if (pairs.length > 0) {
    const filings = await db.select().from(formFilings);
    const drop = filings.filter((filing) => pairs.some((pair) => pair.formKey === filing.formKey && pair.recordId === filing.recordId));
    for (const filing of drop) {
      if (filing.folderNodeId == null) continue;
      const nodeId = filing.folderNodeId;
      await db.update(formFilings).set({ folderNodeId: null }).where(eq(formFilings.id, filing.id));
      await deleteExclusiveLeaf(db, nodeId, undefined);
    }
    if (drop.length > 0) await db.delete(formFilings).where(inArray(formFilings.id, drop.map((filing) => filing.id)));
  }
  if (staleIso.length > 0) await db.delete(isoQualityForms).where(inArray(isoQualityForms.id, staleIso.map((row) => row.id)));
  if (staleValidation.length > 0) await db.delete(validationReports).where(inArray(validationReports.id, staleValidation.map((row) => row.id)));
}

async function formSavedIds(db: Db, formTypes: string[]): Promise<Set<number>> {
  if (formTypes.length === 0) return new Set();
  const rows = await db
    .select({ entityId: formData.entityId })
    .from(formData)
    .where(and(inArray(formData.formType, formTypes), isNotNull(formData.updatedAt)));
  const ids = new Set<number>();
  for (const row of rows) {
    if (row.entityId != null) ids.add(row.entityId);
  }
  return ids;
}

/** Live saved-form rows. A module copy is kept once it has been saved, numbered, or had its form filled in. */
async function collectSavedCopies(db: Db): Promise<SavedCopy[]> {
  const copies: SavedCopy[] = [];
  const known = new Set(FORM_TEMPLATES.map((seed) => seed.formKey));
  const validations = await db
    .select({
      id: validationReports.id,
      formType: sql<string | null>`${validationReports.data}->>'formType'`,
      recordNumber: validationReports.recordNumber,
      createdAt: validationReports.createdAt,
      updatedAt: validationReports.updatedAt,
    })
    .from(validationReports);
  for (const row of validations) pushCopy(copies, validationFormKeyFor({ formType: row.formType }), row.id, row.createdAt, row.recordNumber, row.updatedAt != null);
  const isos = await db
    .select({ id: isoQualityForms.id, formType: isoQualityForms.formType, recordNumber: isoQualityForms.recordNumber, createdAt: isoQualityForms.createdAt, updatedAt: isoQualityForms.updatedAt })
    .from(isoQualityForms);
  for (const row of isos) pushCopy(copies, ISO_TYPE_TO_FORM_KEY[row.formType], row.id, row.createdAt, row.recordNumber, row.updatedAt != null);
  const qmsRows = await db.select({ id: qmsForms.id, formType: qmsForms.formType, formNo: qmsForms.formNo, createdAt: qmsForms.createdAt, updatedAt: qmsForms.updatedAt }).from(qmsForms);
  for (const row of qmsRows) {
    if (!known.has(row.formType)) continue;
    pushCopy(copies, row.formType, row.id, row.createdAt, row.formNo, row.updatedAt != null);
  }
  const ncrSaved = await formSavedIds(db, ["ncr", "five_why", "pareto_chart"]);
  const ncrRows = await db
    .select({ id: ncr.id, title: ncr.title, recordNumber: ncr.recordNumber, createdAt: ncr.createdAt, updatedAt: ncr.updatedAt })
    .from(ncr)
    .where(eq(ncr.isDeleted, false));
  for (const row of ncrRows) {
    const key = blankFormKeyForCreate("/ncr", { title: row.title });
    pushCopy(copies, key, row.id, row.createdAt, row.recordNumber, moduleRecordKept(row.updatedAt, row.recordNumber) || ncrSaved.has(row.id), { label: row.title, updatedAt: row.updatedAt });
  }
  const capaSaved = await formSavedIds(db, ["capa"]);
  const capaRows = await db.select({ id: capa.id, recordNumber: capa.recordNumber, createdAt: capa.createdAt, updatedAt: capa.updatedAt }).from(capa);
  for (const row of capaRows) pushCopy(copies, "capa", row.id, row.createdAt, row.recordNumber, moduleRecordKept(row.updatedAt, row.recordNumber) || capaSaved.has(row.id), { updatedAt: row.updatedAt });
  const eightSaved = await formSavedIds(db, ["eight_d"]);
  const eightRows = await db.select({ id: eightD.id, recordNumber: eightD.recordNumber, createdAt: eightD.createdAt, updatedAt: eightD.updatedAt }).from(eightD);
  for (const row of eightRows) pushCopy(copies, "8d", row.id, row.createdAt, row.recordNumber, moduleRecordKept(row.updatedAt, row.recordNumber) || eightSaved.has(row.id), { updatedAt: row.updatedAt });
  const dcrRows = await db
    .select({
      id: documentChangeRequests.id,
      formNo: documentChangeRequests.formNo,
      documentProcessName: documentChangeRequests.documentProcessName,
      createdAt: documentChangeRequests.createdAt,
      updatedAt: documentChangeRequests.updatedAt,
    })
    .from(documentChangeRequests);
  for (const row of dcrRows) {
    pushCopy(copies, "dcr", row.id, row.createdAt, row.formNo, moduleRecordKept(row.updatedAt, row.formNo), { label: row.documentProcessName, updatedAt: row.updatedAt });
  }
  const riskSaved = await formSavedIds(db, ["fmea"]);
  const riskRows = await db.select({ id: riskAssessments.id, title: riskAssessments.title, recordNumber: riskAssessments.recordNumber, createdAt: riskAssessments.createdAt, updatedAt: riskAssessments.updatedAt }).from(riskAssessments);
  for (const row of riskRows) pushCopy(copies, "risk", row.id, row.createdAt, row.recordNumber, moduleRecordKept(row.updatedAt, row.recordNumber) || riskSaved.has(row.id), { label: row.title, updatedAt: row.updatedAt });
  const trainingSaved = await formSavedIds(db, ["training", "competency_matrix"]);
  const trainingRows = await db.select({ id: trainingCourses.id, title: trainingCourses.title, createdAt: trainingCourses.createdAt, updatedAt: trainingCourses.updatedAt }).from(trainingCourses);
  for (const row of trainingRows) pushCopy(copies, "training-record", row.id, row.createdAt, null, moduleRecordKept(row.updatedAt, null) || trainingSaved.has(row.id), { label: row.title, updatedAt: row.updatedAt });
  const changeSaved = await formSavedIds(db, ["change", "pcn"]);
  const changeRows = await db
    .select({ id: changeRequests.id, title: changeRequests.title, recordNumber: changeRequests.recordNumber, createdAt: changeRequests.createdAt, updatedAt: changeRequests.updatedAt })
    .from(changeRequests);
  for (const row of changeRows) {
    const key = blankFormKeyForCreate("/change", { title: row.title });
    pushCopy(copies, key, row.id, row.createdAt, row.recordNumber, moduleRecordKept(row.updatedAt, row.recordNumber) || changeSaved.has(row.id), { label: row.title, updatedAt: row.updatedAt });
  }
  const auditSaved = await formSavedIds(db, ["audit_plan", "audit_checklist", "lpa"]);
  const auditRows = await db.select({ id: audits.id, name: audits.name, recordNumber: audits.recordNumber, status: audits.status, createdAt: audits.createdAt }).from(audits);
  const auditItemRows = await db.select({ auditId: auditItems.auditId }).from(auditItems);
  const auditsWithItems = new Set(auditItemRows.map((row) => row.auditId));
  for (const row of auditRows) {
    if (!auditRecordKept({ recordNumber: row.recordNumber, status: row.status, hasItems: auditsWithItems.has(row.id) }) && !auditSaved.has(row.id)) continue;
    const key = blankFormKeyForCreate("/audits", { name: row.name });
    pushCopy(copies, key, row.id, row.createdAt, row.recordNumber, true, { label: row.name });
  }
  const equipmentSaved = await formSavedIds(db, ["calibration", "gage_rr", "maintenance_work_order"]);
  const equipmentRows = await db
    .select({ id: equipment.id, name: equipment.name, location: equipment.location, serialNumber: equipment.serialNumber, type: equipment.type, createdAt: equipment.createdAt })
    .from(equipment);
  for (const row of equipmentRows) {
    const used = Boolean(row.location?.trim() || row.serialNumber?.trim() || row.type?.trim()) || equipmentSaved.has(row.id);
    if (!used) continue;
    const key = blankFormKeyForCreate("/equipment", { name: row.name });
    pushCopy(copies, key, row.id, row.createdAt, null, true, { label: row.name });
  }
  return copies.filter((copy) => known.has(copy.formKey));
}

function restoredFileName(copy: SavedCopy, formNumber: string, remembered: string | undefined): string {
  if (remembered?.trim()) return remembered.trim();
  const seed = FORM_TEMPLATES.find((item) => item.formKey === copy.formKey);
  const formId = (formNumber || seed?.formId || "").trim();
  // The folder list dates a module copy from its save. A numbered form keeps the created date.
  const when = !formId && copy.updatedAt ? copy.updatedAt : (copy.createdAt ?? new Date());
  return savedFillFileName({
    formId,
    title: seed?.title ?? "Form",
    recordId: copy.recordId,
    savedAt: when.toISOString(),
    pattern: fileNamePatternFor(seed ?? { fileNamePattern: FILE_NAME_PATTERN }),
    recordLabel: copy.label,
    number: copy.recordNumber,
  });
}

async function rememberedFileNames(db: Db): Promise<Map<string, string>> {
  const rows = await db
    .select({ changes: auditTrail.changes, createdAt: auditTrail.createdAt })
    .from(auditTrail)
    .where(and(eq(auditTrail.entityType, FOLDER_AUDIT), sql`${auditTrail.changes}->>'event' in ('orphan_removed', 'filed')`));
  const ordered = [...rows].sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
  const names = new Map<string, string>();
  for (const row of ordered) {
    const changes = row.changes ?? {};
    const linked = typeof changes.linkedPath === "string" ? pathOnly(changes.linkedPath) : "";
    const name = typeof changes.name === "string" ? changes.name.trim() : "";
    if (!linked || !name || !parseRecordLink(linked)) continue;
    names.set(linked, name);
  }
  return names;
}

/** Take a never-saved copy out of its folder. The record and its form-number snapshot stay. */
async function releaseUnsavedFolderNodes(db: Db, performedBy?: number): Promise<void> {
  const unsaved = new Set((await collectSavedCopies(db)).filter((copy) => !copy.userSaved).map((copy) => `${copy.formKey}:${copy.recordId}`));
  if (unsaved.size === 0) return;
  const filings = await db.select().from(formFilings);
  for (const filing of filings) {
    if (filing.folderNodeId == null || !unsaved.has(`${filing.formKey}:${filing.recordId}`)) continue;
    const nodeId = filing.folderNodeId;
    await db.update(formFilings).set({ folderNodeId: null, updatedAt: new Date() }).where(eq(formFilings.id, filing.id));
    await deleteExclusiveLeaf(db, nodeId, performedBy);
  }
}

/** Put a saved record back into its per-form folder when the filing or the file node is missing. */
async function refileMissingSavedRecords(db: Db, performedBy?: number): Promise<void> {
  const copies = (await collectSavedCopies(db)).filter((copy) => copy.userSaved);
  if (copies.length === 0) return;
  const existing = await db
    .select({ formKey: formFilings.formKey, recordId: formFilings.recordId, folderNodeId: formFilings.folderNodeId })
    .from(formFilings);
  const have = new Set(existing.map((row) => `${row.formKey}:${row.recordId}`));
  const placedFolderIds = new Set((await db.select({ id: documentFolders.id }).from(documentFolders)).map((folder) => folder.id));
  // A live file already stored under any key for this record stays where it is. Repair does not add a second copy.
  const alreadyPlaced = (formKey: string, recordId: number) => {
    const kind = MODULE_KIND[formKey];
    if (!kind) return false;
    return existing.some(
      (filing) =>
        filing.recordId === recordId &&
        MODULE_KIND[filing.formKey] === kind &&
        filing.folderNodeId != null &&
        placedFolderIds.has(filing.folderNodeId),
    );
  };
  const missing = copies.filter((copy) => !have.has(`${copy.formKey}:${copy.recordId}`) && !alreadyPlaced(copy.formKey, copy.recordId));
  if (missing.length > 0) {
    await db
      .insert(formFilings)
      .values(
        missing.map((copy) => ({
          formKey: copy.formKey,
          recordId: copy.recordId,
          formNumber: FORM_TEMPLATES.find((seed) => seed.formKey === copy.formKey)?.formId ?? "",
        })),
      )
      .onConflictDoNothing({ target: [formFilings.formKey, formFilings.recordId] });
  }

  const filings = await db.select().from(formFilings);
  const folders = await db
    .select({
      id: documentFolders.id,
      name: documentFolders.name,
      parentId: documentFolders.parentId,
      linkedPath: documentFolders.linkedPath,
      documentId: documentFolders.documentId,
      pdfPath: documentFolders.pdfPath,
    })
    .from(documentFolders);
  const folderIds = new Set(folders.map((folder) => folder.id));
  const usedNodes = new Set(filings.flatMap((filing) => (filing.folderNodeId != null && folderIds.has(filing.folderNodeId) ? [filing.folderNodeId] : [])));
  const childCount = new Map<number, number>();
  for (const folder of folders) {
    if (folder.parentId == null) continue;
    childCount.set(folder.parentId, (childCount.get(folder.parentId) ?? 0) + 1);
  }
  const filingByKey = new Map(filings.map((filing) => [`${filing.formKey}:${filing.recordId}`, filing]));
  const needNodes = copies.filter((copy) => {
    if (!FILEABLE_FORM_KEYS.has(copy.formKey) && !(copy.formKey in MODULE_KIND)) return false;
    const filing = filingByKey.get(`${copy.formKey}:${copy.recordId}`);
    if (filing == null || (filing.folderNodeId != null && folderIds.has(filing.folderNodeId))) return false;
    const kind = MODULE_KIND[copy.formKey];
    if (!kind) return true;
    const siblingHasFile = filings.some(
      (row) =>
        row.recordId === copy.recordId &&
        row.id !== filing.id &&
        MODULE_KIND[row.formKey] === kind &&
        row.folderNodeId != null &&
        folderIds.has(row.folderNodeId),
    );
    return !siblingHasFile;
  });
  if (needNodes.length === 0) return;

  let iso = folders.find((folder) => folder.parentId == null && folder.name === ISO_DOCUMENTS_FOLDER);
  if (!iso) {
    await ensureFormTemplates(db, performedBy);
    const refreshed = await db
      .select({
        id: documentFolders.id,
        name: documentFolders.name,
        parentId: documentFolders.parentId,
        linkedPath: documentFolders.linkedPath,
        documentId: documentFolders.documentId,
        pdfPath: documentFolders.pdfPath,
      })
      .from(documentFolders);
    folders.splice(0, folders.length, ...refreshed);
    childCount.clear();
    for (const folder of folders) {
      if (folder.parentId == null) continue;
      childCount.set(folder.parentId, (childCount.get(folder.parentId) ?? 0) + 1);
    }
    iso = folders.find((folder) => folder.parentId == null && folder.name === ISO_DOCUMENTS_FOLDER);
  }
  if (!iso) return;
  const names = await rememberedFileNames(db);
  let root = folders.find((folder) => folder.parentId === iso.id && folder.name === SAVED_FORM_FOLDERS_ROOT);
  if (!root) {
    const siblings = folders.filter((folder) => folder.parentId === iso.id);
    const [created] = await db.insert(documentFolders).values({ name: SAVED_FORM_FOLDERS_ROOT, parentId: iso.id, sortOrder: siblings.length }).returning({
      id: documentFolders.id,
      name: documentFolders.name,
      parentId: documentFolders.parentId,
      linkedPath: documentFolders.linkedPath,
      documentId: documentFolders.documentId,
      pdfPath: documentFolders.pdfPath,
    });
    if (!created) return;
    root = created;
    folders.push(created);
  }
  const parentByKey = new Map<string, number>();

  for (const copy of needNodes) {
    const filing = filingByKey.get(`${copy.formKey}:${copy.recordId}`);
    if (!filing) continue;
    const canonical = canonicalOpenPath(copy.formKey, copy.recordId);
    const reusable = folders.find(
      (folder) =>
        pathOnly(folder.linkedPath) === canonical &&
        !usedNodes.has(folder.id) &&
        folder.documentId == null &&
        !folder.pdfPath &&
        (childCount.get(folder.id) ?? 0) === 0,
    );
    if (reusable) {
      await db.update(formFilings).set({ folderNodeId: reusable.id, updatedAt: new Date() }).where(eq(formFilings.id, filing.id));
      usedNodes.add(reusable.id);
      continue;
    }
    let parentId = parentByKey.get(copy.formKey);
    if (parentId == null) {
      const marker = `/form-folders/${copy.formKey}`;
      const seed = FORM_TEMPLATES.find((item) => item.formKey === copy.formKey);
      let parent = folders.find((folder) => folder.parentId === root.id && folder.linkedPath === marker);
      if (!parent) {
        const siblings = folders.filter((folder) => folder.parentId === root.id);
        const [created] = await db
          .insert(documentFolders)
          .values({ name: seed?.title?.trim() || copy.formKey, parentId: root.id, sortOrder: siblings.length, linkedPath: marker })
          .returning({
            id: documentFolders.id,
            name: documentFolders.name,
            parentId: documentFolders.parentId,
            linkedPath: documentFolders.linkedPath,
            documentId: documentFolders.documentId,
            pdfPath: documentFolders.pdfPath,
          });
        if (!created) continue;
        parent = created;
        folders.push(created);
        childCount.set(root.id, (childCount.get(root.id) ?? 0) + 1);
      }
      parentId = parent.id;
      parentByKey.set(copy.formKey, parentId);
    }
    const name = restoredFileName(copy, filing.formNumber, names.get(canonical));
    const siblings = folders.filter((folder) => folder.parentId === parentId);
    const [created] = await db
      .insert(documentFolders)
      .values({ name, parentId, sortOrder: siblings.length, linkedPath: canonical })
      .returning({
        id: documentFolders.id,
        name: documentFolders.name,
        parentId: documentFolders.parentId,
        linkedPath: documentFolders.linkedPath,
        documentId: documentFolders.documentId,
        pdfPath: documentFolders.pdfPath,
      });
    if (!created) continue;
    folders.push(created);
    childCount.set(parentId, (childCount.get(parentId) ?? 0) + 1);
    usedNodes.add(created.id);
    await db.update(formFilings).set({ folderNodeId: created.id, updatedAt: new Date() }).where(eq(formFilings.id, filing.id));
    await recordAuditTrail(db, {
      entityType: FOLDER_AUDIT,
      entityId: created.id,
      action: "create",
      changes: { event: "filed", name, parentId, formKey: copy.formKey, recordId: copy.recordId, linkedPath: canonical },
      performedBy,
    });
  }
}

/** Point a filed copy at the record that was saved. Adds a missing file. Does not detach, delete, or move a live one. */
export async function repairSavedFormListings(db: Db, performedBy?: number): Promise<void> {
  if (await skipSavedListingRepair(db)) return;
  await deleteExpiredUnsavedDrafts(db);
  await releaseUnsavedFolderNodes(db, performedBy);
  await refileMissingSavedRecords(db, performedBy);
  const filings = await db.select().from(formFilings);
  const folders = await db
    .select({
      id: documentFolders.id,
      name: documentFolders.name,
      parentId: documentFolders.parentId,
      linkedPath: documentFolders.linkedPath,
      documentId: documentFolders.documentId,
      pdfPath: documentFolders.pdfPath,
    })
    .from(documentFolders);
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const childCount = new Map<number, number>();
  for (const folder of folders) {
    if (folder.parentId == null) continue;
    childCount.set(folder.parentId, (childCount.get(folder.parentId) ?? 0) + 1);
  }
  const filingsByNode = new Map<number, typeof filings>();
  for (const filing of filings) {
    if (filing.folderNodeId == null) continue;
    const list = filingsByNode.get(filing.folderNodeId) ?? [];
    list.push(filing);
    filingsByNode.set(filing.folderNodeId, list);
  }

  const wanted = new Map<RecordKind, number[]>();
  for (const filing of filings) {
    const kind = kindForFormKey(filing.formKey);
    if (kind && kind !== "page") remember(wanted, kind, filing.recordId);
  }
  const alive = await loadAlive(db, wanted);

  function filingAlive(formKey: string, recordId: number): boolean {
    const kind = kindForFormKey(formKey);
    if (kind === "page") return true;
    if (!kind) return true;
    return alive.has(aliveKey(kind, recordId));
  }

  for (const filing of filings) {
    if (!filingAlive(filing.formKey, filing.recordId) || filing.folderNodeId == null) continue;
    const node = folderById.get(filing.folderNodeId);
    if (!node) continue;
    const remaining = filingsByNode.get(node.id) ?? [];
    const expected = canonicalOpenPath(filing.formKey, filing.recordId);
    if (
      !shouldRepairFiledLink({
        linkedPath: node.linkedPath,
        expected,
        soleFiling: remaining.length === 1,
        hasChildren: (childCount.get(node.id) ?? 0) > 0,
      })
    ) {
      continue;
    }
    if (node.documentId != null || node.pdfPath) continue;
    await db.update(documentFolders).set({ linkedPath: expected, updatedAt: new Date() }).where(eq(documentFolders.id, node.id));
    await recordAuditTrail(db, {
      entityType: FOLDER_AUDIT,
      entityId: node.id,
      action: "update",
      changes: { event: "link_repaired", name: node.name, from: node.linkedPath, to: expected, formKey: filing.formKey, recordId: filing.recordId },
      performedBy,
    });
    node.linkedPath = expected;
  }
  await rememberSavedListingStamp(db);
}

/** Record-delete kinds that have a saved-form listing. Unlisted kinds are left alone. */
const DELETION_LISTING: Record<string, RecordKind> = {
  ncr: "ncr",
  complaint: "ncr",
  capa: "capa",
  eight_d: "eight_d",
  validation_report: "validation",
  iso_quality_form: "iso",
  qms: "qms",
  dcr: "dcr",
  risk: "risk",
  audit: "audit",
  equipment: "equipment",
  training: "training",
  change: "change",
};

/**
 * Remove the folder file for one saved copy after that record is gone.
 * If the record is still there, this does nothing. It never sweeps other records
 * and it does not run the listing-time cleanup.
 */
export async function forgetRecordListings(db: Db, kind: string, row: Record<string, unknown>, performedBy?: number): Promise<void> {
  const id = Number(row.id);
  if (!Number.isInteger(id) || id < 1) return;
  const listed = DELETION_LISTING[kind];
  if (listed) {
    const alive = await idsOf(db, listed, [id]);
    if (alive.has(id)) return;
  }
  const paths = new Set<string>();
  const formKeys: string[] = [];
  if (kind === "validation_report") {
    const key = validationFormKeyFor(row.data);
    formKeys.push(key);
    paths.add(canonicalOpenPath(key, id));
  } else if (kind === "iso_quality_form") {
    const key = ISO_TYPE_TO_FORM_KEY[String(row.formType ?? "")];
    if (key) formKeys.push(key);
    paths.add(`/iso-forms/record/${id}`);
  } else if (kind === "qms") {
    const formType = String(row.formType ?? "");
    if (formType) {
      formKeys.push(formType);
      paths.add(`/qms-forms/${formType}/${id}`);
    }
  } else if (kind === "ncr") paths.add(`/ncr/${id}`);
  else if (kind === "capa") paths.add(`/capa/${id}`);
  else if (kind === "eight_d") paths.add(`/8d/${id}`);
  else if (kind === "dcr") paths.add(`/document-change-requests/${id}`);
  else if (kind === "risk") paths.add(`/risk/${id}`);
  else if (kind === "audit") paths.add(`/audits/${id}`);
  else if (kind === "equipment") paths.add(`/calibration/${id}`);
  else if (kind === "training") paths.add(`/training/${id}`);
  else if (kind === "change") paths.add(`/change/${id}`);

  const filings = await db.select().from(formFilings).where(eq(formFilings.recordId, id));
  const matching = filings.filter((filing) => {
    if (formKeys.includes(filing.formKey)) return true;
    if (paths.has(canonicalOpenPath(filing.formKey, filing.recordId))) return true;
    return listed != null && kindForFormKey(filing.formKey) === listed;
  });
  const nodeIds = new Set<number>();
  for (const filing of matching) {
    if (filing.folderNodeId != null) nodeIds.add(filing.folderNodeId);
  }
  if (matching.length > 0) await db.delete(formFilings).where(inArray(formFilings.id, matching.map((filing) => filing.id)));
  if (paths.size > 0) {
    const linked = await db.select({ id: documentFolders.id }).from(documentFolders).where(inArray(documentFolders.linkedPath, [...paths]));
    for (const node of linked) nodeIds.add(node.id);
  }
  for (const nodeId of nodeIds) await deleteExclusiveLeaf(db, nodeId, performedBy);
}

/** Paths that still open a record. A path this app does not recognize stays, so a menu link is not dropped. */
export async function liveRecordPaths(db: Db, paths: string[]): Promise<string[]> {
  const parsed = paths.map((path) => ({ path, link: parseRecordLink(path) }));
  const wanted = new Map<RecordKind, number[]>();
  for (const item of parsed) {
    if (item.link) remember(wanted, item.link.kind, item.link.id);
  }
  const alive = await loadAlive(db, wanted);
  return parsed.filter((item) => !item.link || alive.has(aliveKey(item.link.kind, item.link.id))).map((item) => item.path);
}

/** Folder files whose name matches a search and whose record is still there. */
export async function searchSavedFormFiles(db: Db, q: string, alreadyRepaired = false): Promise<{ id: number; label: string; path: string }[]> {
  const needle = q.trim();
  if (!needle) return [];
  if (!alreadyRepaired) await repairSavedFormListings(db);
  const escaped = needle.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const rows = await db
    .select({ id: documentFolders.id, name: documentFolders.name, linkedPath: documentFolders.linkedPath })
    .from(documentFolders)
    .where(sql`${documentFolders.name} ILIKE ${`%${escaped}%`} ESCAPE '\\'`)
    .limit(100);
  const hits = rows.flatMap((row) => {
    const path = pathOnly(row.linkedPath);
    const link = parseRecordLink(path);
    if (!link) return [];
    return [{ id: row.id, label: row.name, path, link }];
  });
  const wanted = new Map<RecordKind, number[]>();
  for (const hit of hits) remember(wanted, hit.link.kind, hit.link.id);
  const alive = await loadAlive(db, wanted);
  return hits
    .filter((hit) => alive.has(aliveKey(hit.link.kind, hit.link.id)))
    .slice(0, 20)
    .map(({ id, label, path }) => ({ id, label, path }));
}
