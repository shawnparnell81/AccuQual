import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { eq } from "drizzle-orm";
import type { Request } from "express";
import { calibrations, equipment } from "../../drizzle/schema/calibration.js";
import { controlledLists } from "../../drizzle/schema/controlledLists.js";
import { controlledFormTemplates } from "../../drizzle/schema/controlledForms.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import { documents } from "../../drizzle/schema/documents.js";
import { users } from "../../drizzle/schema/users.js";
import type { Db } from "../../lib/requestDb.js";
import { getUserAccessLevel } from "../../middleware/departmentAccess.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { ensureCompanyDocumentFolders } from "../document-folders/companyDocumentFolders.js";
import { ensureFormTemplates } from "../document-folders/formTemplates.js";
import { listMasterDocuments } from "../documents/masterDocumentList.js";
import { purgeExistingRecord } from "../records/recordDeletion.js";
import { AppError } from "../../utils/appError.js";
import { logger } from "../../utils/logger.js";
import {
  EQUIPMENT_STATUSES,
  LISTS,
  addDataRow,
  appendDocuments,
  appendEquipment,
  applyInputPatch,
  changeSummary,
  freshSheets,
  insertLocationPath,
  isLivingListPath,
  planListCleanup,
  removeDataRow,
  restoreHeaderBlock,
  rowSummary,
  titleMatchesDevLog,
  titleMatchesList,
  type CellPatch,
  type ListKey,
} from "./logic.js";
import type { StoredSheet } from "./math.js";
import { buildListWorkbook, workbookFileName } from "./workbook.js";

const ISO_ROOT = "ISO Compliance Documents";
const QUALITY_MANUAL = "Quality Manual";

export interface ControlledListView {
  id: number;
  listKey: ListKey;
  title: string;
  docId: string;
  revision: string;
  route: string;
  landscape: boolean;
  resource: "documents" | "calibration";
  statuses: readonly string[];
  sheets: StoredSheet[];
}

async function personName(db: Db, userId: number): Promise<string> {
  const [person] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId));
  return (person?.name || person?.email || "Someone").trim() || "Someone";
}

function viewOf(row: { id: number; revision: string; sheets: StoredSheet[] }, key: ListKey): ControlledListView {
  const spec = LISTS[key];
  return {
    id: row.id,
    listKey: key,
    title: spec.title,
    docId: spec.docId,
    revision: row.revision,
    route: spec.route,
    landscape: spec.landscape,
    resource: spec.resource,
    statuses: key === "lst-eqp-001" ? EQUIPMENT_STATUSES : [],
    sheets: row.sheets,
  };
}

async function loadRow(db: Db, key: ListKey) {
  const [row] = await db.select().from(controlledLists).where(eq(controlledLists.listKey, key));
  return row ?? null;
}

async function repairStoredHeader(db: Db, key: ListKey, row: { id: number; revision: string; sheets: StoredSheet[] }, userId: number) {
  const restored = restoreHeaderBlock(key, row.sheets);
  if (!restored.changed) return row;
  await db.update(controlledLists).set({ sheets: restored.sheets, updatedAt: new Date() }).where(eq(controlledLists.id, row.id));
  const who = await personName(db, userId);
  const spec = LISTS[key];
  await recordAuditTrail(db, {
    entityType: "ControlledList",
    entityId: row.id,
    action: "update",
    performedBy: userId,
    changes: {
      summary: `${who} restored the top header rows on ${spec.docId} from the controlled workbook. Revision stayed ${row.revision}.`,
    },
  });
  return { ...row, sheets: restored.sheets };
}

async function ensureRow(db: Db, key: ListKey) {
  const existing = await loadRow(db, key);
  if (existing) return existing;
  const spec = LISTS[key];
  const [created] = await db
    .insert(controlledLists)
    .values({ listKey: key, revision: spec.revision, sheets: freshSheets(key) })
    .returning();
  if (!created) throw new Error(`Could not create ${spec.title}`);
  return created;
}

function listStatus(status: string, metadata: Record<string, unknown> | null): string {
  const stored = typeof metadata?.listStatus === "string" ? metadata.listStatus.trim() : "";
  if ((EQUIPMENT_STATUSES as readonly string[]).includes(stored)) return stored;
  if (status === "out_of_service") return "Out of Service";
  if (status === "inactive") return "Scrapped";
  return "Active";
}

function intervalMonths(days: number, metadata: Record<string, unknown> | null): number {
  const stored = metadata?.calIntervalMonths;
  if (typeof stored === "number" && stored > 0) return Math.round(stored);
  if (!Number.isFinite(days) || days <= 0) return 12;
  return Math.max(1, Math.round((days * 12) / 365));
}

async function equipmentAppends(db: Db) {
  const items = await db.select().from(equipment);
  const events = await db.select({ equipmentId: calibrations.equipmentId, performedAt: calibrations.performedAt }).from(calibrations);
  const latest = new Map<number, string>();
  for (const event of events) {
    if (!event.performedAt) continue;
    const iso = event.performedAt.toISOString().slice(0, 10);
    const prev = latest.get(event.equipmentId);
    if (!prev || iso > prev) latest.set(event.equipmentId, iso);
  }
  return items.map((item) => {
    const metadata = (item.metadata ?? {}) as Record<string, unknown>;
    const asset = typeof metadata.assetId === "string" && metadata.assetId.trim() ? metadata.assetId.trim() : String(item.id);
    return {
      assetId: asset,
      name: item.name,
      manufacturer: typeof metadata.manufacturer === "string" ? metadata.manufacturer : "",
      serial: item.serialNumber ?? "",
      location: item.location ?? "",
      method: typeof metadata.method === "string" ? metadata.method : "",
      intervalMonths: intervalMonths(item.calibrationIntervalDays, metadata),
      lastCal: latest.get(item.id) ?? "",
      status: listStatus(item.status, metadata),
    };
  });
}

async function absorbOutsideRows(db: Db, key: ListKey, sheets: StoredSheet[], userId: number, listId: number): Promise<StoredSheet[]> {
  let current = sheets;
  const notes: string[] = [];
  if (key === "lst-gen-001") {
    const register = await listMasterDocuments(db);
    const merged = appendDocuments(current, register);
    current = merged.sheets;
    if (merged.added.length > 0) notes.push(`Added ${merged.added.length} controlled documents that were not already on Internal Documents: ${merged.added.join(", ")}.`);
  }
  if (key === "lst-eqp-001") {
    const merged = appendEquipment(current, await equipmentAppends(db));
    current = merged.sheets;
    if (merged.added.length > 0) notes.push(`Added ${merged.added.length} equipment records that were not already on the list: ${merged.added.join(", ")}.`);
  }
  if (notes.length === 0) return current;
  await db.update(controlledLists).set({ sheets: current, updatedAt: new Date() }).where(eq(controlledLists.id, listId));
  const who = await personName(db, userId);
  await recordAuditTrail(db, {
    entityType: "ControlledList",
    entityId: listId,
    action: "update",
    performedBy: userId,
    changes: { summary: `${who} ${notes.join(" ")} Revision stayed ${LISTS[key].revision}.`, added: notes },
  });
  return current;
}

async function fileLivingNodes(db: Db, userId: number) {
  let folders = await db.select().from(documentFolders);
  folders = await ensureCompanyDocumentFolders(db, folders);
  const iso = folders.find((folder) => folder.parentId == null && folder.name === ISO_ROOT);
  if (!iso) return;
  for (const spec of Object.values(LISTS)) {
    const parentName = spec.folder ?? QUALITY_MANUAL;
    const parent = folders.find((folder) => folder.parentId === iso.id && folder.name === parentName);
    if (!parent) continue;
    const nodeName = spec.nodeName ?? spec.title;
    const linked = folders.find((folder) => folder.parentId === parent.id && folder.linkedPath === spec.route);
    if (linked) continue;
    const named = folders.find((folder) => folder.parentId === parent.id && folder.name === nodeName && !folder.pdfPath && folder.documentId == null && !folder.linkedPath);
    if (named) {
      await db.update(documentFolders).set({ linkedPath: spec.route, updatedAt: new Date() }).where(eq(documentFolders.id, named.id));
      await recordAuditTrail(db, {
        entityType: "DocumentFolder",
        entityId: named.id,
        action: "update",
        performedBy: userId,
        changes: { summary: `Opened ${nodeName} from ${parentName} into the in-app list.`, linkedPath: spec.route },
      });
      continue;
    }
    const siblings = folders.filter((folder) => folder.parentId === parent.id);
    const [created] = await db
      .insert(documentFolders)
      .values({ name: nodeName, parentId: parent.id, sortOrder: siblings.length, linkedPath: spec.route })
      .returning();
    if (!created) continue;
    folders = [...folders, created];
    await recordAuditTrail(db, {
      entityType: "DocumentFolder",
      entityId: created.id,
      action: "create",
      performedBy: userId,
      changes: { summary: `Filed ${nodeName} in ${parentName}. Opening it edits the list in the app.`, name: nodeName, linkedPath: spec.route },
    });
  }
}

async function canEditDocuments(req: Request): Promise<boolean> {
  if (!req.db || !req.user) return false;
  return (await getUserAccessLevel(req.db, req.user, "documents")) === "edit";
}

/** Remove the uploaded Quality Manual copies and any blank form with these titles. Safe to run again. */
export async function retireSupersededLists(req: Request): Promise<void> {
  if (!req.db || !req.user) return;
  if (!(await canEditDocuments(req))) return;
  const db = req.db;
  const folders = await db.select().from(documentFolders);
  const docs = await db.select({ id: documents.id, title: documents.title, isDeleted: documents.isDeleted }).from(documents);
  const templates = await db.select().from(controlledFormTemplates);
  const plan = planListCleanup(folders, docs, templates);

  for (const folder of folders) {
    if (!isLivingListPath(folder.linkedPath) || !folder.pdfPath) continue;
    if (existsSync(folder.pdfPath)) {
      await unlink(folder.pdfPath).catch((err) => logger.warn(`Could not remove living-list attachment ${folder.pdfPath}`, err));
    }
    await db.update(documentFolders).set({ pdfPath: null, pdfMimeType: null, updatedAt: new Date() }).where(eq(documentFolders.id, folder.id));
    await recordAuditTrail(db, {
      entityType: "DocumentFolder",
      entityId: folder.id,
      action: "update",
      performedBy: req.user.id,
      changes: { action: "remove_template", summary: `Removed the uploaded file on ${folder.name}. The in-app list is the controlled copy.` },
    });
  }

  for (const id of plan.templateIds) {
    const [removed] = await db.delete(controlledFormTemplates).where(eq(controlledFormTemplates.id, id)).returning();
    if (!removed) continue;
    await recordAuditTrail(db, {
      entityType: "ControlledFormTemplate",
      entityId: id,
      action: "delete",
      performedBy: req.user.id,
      changes: {
        summary: `Deleted the blank form "${removed.title}"${removed.formId ? ` (${removed.formId})` : ""}. It is a living list in the Quality Manual, not a blank form.`,
        title: removed.title,
        formKey: removed.formKey,
        formId: removed.formId,
      },
    });
  }

  const childIds = new Set(folders.map((folder) => folder.parentId).filter((id): id is number => id != null));
  const depthOf = (id: number) => {
    let depth = 0;
    let current = folders.find((folder) => folder.id === id);
    const seen = new Set<number>();
    while (current?.parentId != null && !seen.has(current.id)) {
      seen.add(current.id);
      depth += 1;
      current = folders.find((folder) => folder.id === current?.parentId);
    }
    return depth;
  };
  const folderIds = [...plan.folderNodeIds].sort((a, b) => depthOf(b) - depthOf(a));
  for (const id of folderIds) {
    const [folder] = await db.select().from(documentFolders).where(eq(documentFolders.id, id));
    if (!folder || isLivingListPath(folder.linkedPath)) continue;
    if (folder.pdfPath && existsSync(folder.pdfPath)) {
      await unlink(folder.pdfPath).catch((err) => logger.warn(`Could not remove list copy ${folder.pdfPath}`, err));
    }
    if (childIds.has(folder.id)) {
      await db.update(documentFolders).set({ pdfPath: null, pdfMimeType: null, documentId: null, updatedAt: new Date() }).where(eq(documentFolders.id, folder.id));
      await recordAuditTrail(db, {
        entityType: "DocumentFolder",
        entityId: folder.id,
        action: "update",
        performedBy: req.user.id,
        changes: { action: "remove_template", summary: `Removed the uploaded copy of ${folder.name}. The folder still holds other items.` },
      });
      continue;
    }
    await db.delete(documentFolders).where(eq(documentFolders.id, id));
    await recordAuditTrail(db, {
      entityType: "DocumentFolder",
      entityId: id,
      action: "delete",
      performedBy: req.user.id,
      changes: { summary: `Deleted the old copy of ${folder.name} from the folder tree.`, name: folder.name },
    });
  }

  for (const id of plan.documentIds) {
    const [doc] = await db.select({ id: documents.id, title: documents.title }).from(documents).where(eq(documents.id, id));
    if (!doc || !(titleMatchesList(doc.title) || titleMatchesDevLog(doc.title))) continue;
    try {
      await purgeExistingRecord(req, "document", id);
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 404) continue;
      throw err;
    }
  }
}

export async function ensureLivingControlledLists(req: Request): Promise<void> {
  if (!req.db || !req.user) return;
  for (const key of Object.keys(LISTS) as ListKey[]) {
    const row = await ensureRow(req.db, key);
    const repaired = await repairStoredHeader(req.db, key, row, req.user.id);
    const sheets = await absorbOutsideRows(req.db, key, repaired.sheets, req.user.id, repaired.id);
    if (sheets !== repaired.sheets) repaired.sheets = sheets;
  }
  await retireSupersededLists(req);
  await fileLivingNodes(req.db, req.user.id);
  // Filing recreates any missing seed drawer, including the empty "8D" folder.
  // The blank-form pass removes that numbered placeholder. Run it last so it stays gone.
  await ensureFormTemplates(req.db);
}

async function requireLevel(req: Request, key: ListKey, level: "read" | "edit") {
  if (!req.db || !req.user) throw AppError.unauthorized("Not signed in");
  const access = await getUserAccessLevel(req.db, req.user, LISTS[key].resource);
  if (access === "none" || (level === "edit" && access !== "edit")) {
    throw AppError.forbidden(`You don't have permission to ${level === "edit" ? "edit" : "open"} ${LISTS[key].title}.`);
  }
}

export async function openControlledList(req: Request, key: ListKey): Promise<ControlledListView> {
  await requireLevel(req, key, "read");
  await ensureLivingControlledLists(req);
  const row = await loadRow(req.db!, key);
  if (!row) throw AppError.notFound(LISTS[key].title);
  return viewOf(row, key);
}

export async function saveControlledList(req: Request, key: ListKey, patches: Array<{ name: string; cells: Record<string, CellPatch> }>): Promise<ControlledListView> {
  await requireLevel(req, key, "edit");
  await ensureLivingControlledLists(req);
  const row = await loadRow(req.db!, key);
  if (!row) throw AppError.notFound(LISTS[key].title);
  const applied = applyInputPatch(key, row.sheets, patches);
  if (applied.changes.length === 0) return viewOf(row, key);
  const [updated] = await req
    .db!.update(controlledLists)
    .set({ sheets: applied.sheets, updatedAt: new Date() })
    .where(eq(controlledLists.id, row.id))
    .returning();
  if (!updated) throw AppError.notFound(LISTS[key].title);
  if (updated.revision !== row.revision) {
    await req.db!.update(controlledLists).set({ revision: row.revision }).where(eq(controlledLists.id, row.id));
    updated.revision = row.revision;
  }
  const who = await personName(req.db!, req.user!.id);
  await recordAuditTrail(req.db!, {
    entityType: "ControlledList",
    entityId: row.id,
    action: "update",
    performedBy: req.user!.id,
    changes: { summary: changeSummary(who, applied.changes), cells: applied.changes, revision: row.revision },
  });
  return viewOf({ ...updated, revision: row.revision }, key);
}

/** Puts the list's current folder path into Location cells. Does nothing until this is called. */
export async function insertControlledListLocation(req: Request, key: ListKey, sheetName: string, path: string): Promise<ControlledListView> {
  await requireLevel(req, key, "edit");
  const trimmed = path.trim();
  if (!trimmed) throw AppError.badRequest("The folder path is empty.");
  if (trimmed.length > 500) throw AppError.badRequest("That path is too long.");
  await ensureLivingControlledLists(req);
  const row = await loadRow(req.db!, key);
  if (!row) throw AppError.notFound(LISTS[key].title);
  const sheet = row.sheets.find((item) => item.name === sheetName);
  if (!sheet) throw AppError.badRequest("Choose a sheet.");
  const applied = insertLocationPath(key, row.sheets, sheetName, trimmed);
  if (applied.changes.length === 0) return viewOf(row, key);
  const [updated] = await req.db!.update(controlledLists).set({ sheets: applied.sheets, updatedAt: new Date() }).where(eq(controlledLists.id, row.id)).returning();
  if (!updated) throw AppError.notFound(LISTS[key].title);
  const who = await personName(req.db!, req.user!.id);
  await recordAuditTrail(req.db!, {
    entityType: "ControlledList",
    entityId: row.id,
    action: "update",
    performedBy: req.user!.id,
    changes: {
      summary: `${who} inserted the folder path into Location on ${sheetName}. Revision stayed ${row.revision}.`,
      cells: applied.changes,
      revision: row.revision,
    },
  });
  return viewOf({ ...updated, revision: row.revision }, key);
}

export async function changeControlledListRows(req: Request, key: ListKey, sheetName: string, op: "add" | "delete", row?: number): Promise<ControlledListView> {
  await requireLevel(req, key, "edit");
  await ensureLivingControlledLists(req);
  const current = await loadRow(req.db!, key);
  if (!current) throw AppError.notFound(LISTS[key].title);
  const who = await personName(req.db!, req.user!.id);
  let sheets = current.sheets;
  let summary = "";
  if (op === "add") {
    const added = addDataRow(key, sheets, sheetName);
    if (!added) throw AppError.badRequest("That sheet does not take new rows.");
    sheets = added.sheets;
    summary = rowSummary(who, "added", sheetName, added.row);
  } else {
    if (row == null) throw AppError.badRequest("Choose a row to delete.");
    const label = current.sheets.find((sheet) => sheet.name === sheetName)?.cells[`A${row}`]?.v;
    const removed = removeDataRow(key, sheets, sheetName, row);
    if (!removed) throw AppError.badRequest("That row is part of the header.");
    sheets = removed;
    summary = rowSummary(who, "deleted", sheetName, row, typeof label === "string" ? label : undefined);
  }
  const [updated] = await req.db!.update(controlledLists).set({ sheets, updatedAt: new Date() }).where(eq(controlledLists.id, current.id)).returning();
  if (!updated) throw AppError.notFound(LISTS[key].title);
  await recordAuditTrail(req.db!, {
    entityType: "ControlledList",
    entityId: current.id,
    action: "update",
    performedBy: req.user!.id,
    changes: { summary, revision: current.revision },
  });
  return viewOf({ ...updated, revision: current.revision }, key);
}

export async function downloadControlledList(req: Request, key: ListKey): Promise<{ filename: string; body: Buffer }> {
  const opened = await openControlledList(req, key);
  return { filename: workbookFileName(key), body: await buildListWorkbook(key, opened.sheets) };
}
