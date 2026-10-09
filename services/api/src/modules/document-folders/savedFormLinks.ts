import { and, eq, inArray, sql } from "drizzle-orm";
import { audits } from "../../drizzle/schema/audits.js";
import { capa } from "../../drizzle/schema/capa.js";
import { equipment } from "../../drizzle/schema/calibration.js";
import { changeRequests } from "../../drizzle/schema/change.js";
import { documentChangeRequests } from "../../drizzle/schema/documentChangeRequests.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import { eightD } from "../../drizzle/schema/eightD.js";
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
import { FORM_TEMPLATES } from "./formFiling.js";

/**
 * Saved forms must open the record that was filed, and a deleted record must
 * not leave a clickable file behind. Listing folders runs this again. It only
 * rewrites a link that is already wrong, or removes a file whose record is
 * already gone. No migration: the same pass is safe to run more than once.
 */

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

/** Drop filings and file nodes that point at a record which is already gone, and point the rest at that record. */
export async function repairSavedFormListings(db: Db, performedBy?: number): Promise<void> {
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
  for (const folder of folders) {
    const parsed = parseRecordLink(folder.linkedPath);
    if (parsed) remember(wanted, parsed.kind, parsed.id);
  }
  const alive = await loadAlive(db, wanted);

  function filingAlive(formKey: string, recordId: number): boolean {
    const kind = kindForFormKey(formKey);
    if (kind === "page") return true;
    if (!kind) return true;
    return alive.has(aliveKey(kind, recordId));
  }

  const dropIds = filings.filter((filing) => !filingAlive(filing.formKey, filing.recordId)).map((filing) => filing.id);
  const dropSet = new Set(dropIds);
  if (dropIds.length > 0) await db.delete(formFilings).where(inArray(formFilings.id, dropIds));

  for (const filing of filings) {
    if (dropSet.has(filing.id) || filing.folderNodeId == null) continue;
    const node = folderById.get(filing.folderNodeId);
    if (!node) continue;
    const remaining = (filingsByNode.get(node.id) ?? []).filter((item) => !dropSet.has(item.id));
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

  for (const folder of folders) {
    const parsed = parseRecordLink(folder.linkedPath);
    if (!parsed || alive.has(aliveKey(parsed.kind, parsed.id))) continue;
    const remaining = (filingsByNode.get(folder.id) ?? []).filter((item) => !dropSet.has(item.id));
    if (remaining.length > 0) continue;
    if ((childCount.get(folder.id) ?? 0) > 0) continue;
    if (folder.pdfPath || folder.documentId != null) {
      if (folder.linkedPath) await db.update(documentFolders).set({ linkedPath: null, updatedAt: new Date() }).where(eq(documentFolders.id, folder.id));
      continue;
    }
    await deleteExclusiveLeaf(db, folder.id, performedBy);
  }
}

/** Remove the folder file for one saved copy. Safe to call when that copy was never filed. */
export async function forgetRecordListings(db: Db, kind: string, row: Record<string, unknown>, performedBy?: number): Promise<void> {
  const id = Number(row.id);
  if (!Number.isInteger(id) || id < 1) return;
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
  const matching = filings.filter((filing) => formKeys.includes(filing.formKey) || paths.has(canonicalOpenPath(filing.formKey, filing.recordId)));
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
export async function searchSavedFormFiles(db: Db, q: string): Promise<{ id: number; label: string; path: string }[]> {
  const needle = q.trim();
  if (!needle) return [];
  await repairSavedFormListings(db);
  const escaped = needle.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const rows = await db
    .select({ id: documentFolders.id, name: documentFolders.name, linkedPath: documentFolders.linkedPath })
    .from(documentFolders)
    .where(sql`${documentFolders.name} ILIKE ${`%${escaped}%`} ESCAPE '\\'`)
    .limit(20);
  return rows.flatMap((row) => {
    const path = pathOnly(row.linkedPath);
    if (!parseRecordLink(path)) return [];
    return [{ id: row.id, label: row.name, path }];
  });
}
