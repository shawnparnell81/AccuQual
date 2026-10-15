import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import type { Request } from "express";
import { equipment } from "../../drizzle/schema/calibration.js";
import { company } from "../../drizzle/schema/company.js";
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
import { canEditFormBuilder } from "../form-builder/access.js";
import { CONTROLLED_LISTS_EDIT_PERMISSION } from "../roles/roleAccess.js";
import { roleHasPermission } from "../roles/rolePermissions.js";
import { formBuilderAccess } from "../form-builder/service.js";
import { AppError } from "../../utils/appError.js";
import { logger } from "../../utils/logger.js";
import {
  EQUIPMENT_STATUSES,
  LISTS,
  addDataRow,
  addListColumn,
  appendDocuments,
  appendEquipment,
  applyInputPatch,
  changeSummary,
  freshSheets,
  insertDataRow,
  dropEmptyDataRows,
  dropPlaceholderEquipmentRows,
  PLACEHOLDER_EQUIPMENT_NAMES,
  insertLocationPath,
  isLivingListPath,
  planListCleanup,
  removeDataRows,
  removeListColumn,
  renameListColumn,
  coalesceRevision,
  restoreHeaderBlock,
  revCells,
  revisionLetter,
  rowSummary,
  rowValueList,
  rowsDeletedSummary,
  structureSummary,
  titleMatchesAuditSchedule,
  titleMatchesDevLog,
  titleMatchesEngLog,
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
  dataStart: Record<string, number>;
  /** Adding, renaming, or removing a column. Same permission as Form Builder structure edits. */
  canEditStructure: boolean;
  /** Master lists open read-only. True when this person may click Edit (Edit master lists, plus edit access to the area). */
  canEditList: boolean;
  /** True for the master lists, which need Edit before any change. */
  locked: boolean;
  /** Who has the list open for editing, if anyone. `mine` is true for the person asking. */
  editSession: { byId: number; byName: string; startedAt: string; mine: boolean } | null;
  sheets: StoredSheet[];
}

async function personName(db: Db, userId: number): Promise<string> {
  const [person] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId));
  return (person?.name || person?.email || "Someone").trim() || "Someone";
}

async function acted(db: Db, userId: number): Promise<{ who: string; when: string }> {
  const who = await personName(db, userId);
  const [profile] = await db.select({ profile: company.profile }).from(company).limit(1);
  const timeZone = profile?.profile?.timezone || "UTC";
  const when = new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date());
  return { who, when };
}

async function structureAllowed(req: Request): Promise<boolean> {
  if (!req.db || !req.user) return false;
  const access = await formBuilderAccess(req.db, { id: req.user.id, roleName: req.user.roleName, department: req.user.department });
  return canEditFormBuilder(access);
}

type ListRow = { id: number; revision: string; sheets: StoredSheet[]; editBy?: number | null; editStartedAt?: Date | null; editSnapshot?: StoredSheet[] | null; editRevision?: string | null };

function viewOf(row: ListRow, key: ListKey, canEditStructure: boolean, extra: Pick<ControlledListView, "canEditList" | "locked" | "editSession">): ControlledListView {
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
    dataStart: spec.dataStart,
    canEditStructure,
    ...extra,
    sheets: row.sheets,
  };
}

async function present(req: Request, key: ListKey, row: ListRow): Promise<ControlledListView> {
  const locked = isLockedList(key);
  const canEditList = locked ? await canEditMasterList(req, key) : false;
  // A save or row change returns the updated row without the edit columns. Read them so the page does not re-lock by mistake.
  let session: { editBy: number | null; editStartedAt: Date | null; editSnapshot: StoredSheet[] | null; editRevision: string | null } = {
    editBy: row.editBy ?? null,
    editStartedAt: row.editStartedAt ?? null,
    editSnapshot: row.editSnapshot ?? null,
    editRevision: row.editRevision ?? null,
  };
  if (locked && row.editBy === undefined) {
    const [stored] = await req
      .db!.select({ editBy: controlledLists.editBy, editStartedAt: controlledLists.editStartedAt, editSnapshot: controlledLists.editSnapshot, editRevision: controlledLists.editRevision })
      .from(controlledLists)
      .where(eq(controlledLists.id, row.id));
    if (stored) session = stored;
  }
  const editSession =
    locked && session.editBy != null && session.editStartedAt
      ? { byId: session.editBy, byName: await personName(req.db!, session.editBy), startedAt: session.editStartedAt.toISOString(), mine: session.editBy === req.user?.id }
      : null;
  // Everyone else sees the list as it was when Edit was clicked. Edits in progress are not the controlled copy until Save.
  const shown = editSession && !editSession.mine && session.editSnapshot ? { ...row, sheets: session.editSnapshot, revision: session.editRevision ?? row.revision } : row;
  return viewOf(shown, key, (await structureAllowed(req)) && (!locked || Boolean(editSession?.mine)), { canEditList, locked, editSession });
}

/** Every controlled list (the master lists and the LST logs) opens read-only and needs Edit before any change. */
const LOCKED_LISTS: ReadonlySet<ListKey> = new Set<ListKey>(Object.keys(LISTS) as ListKey[]);

export function isLockedList(key: ListKey): boolean {
  return LOCKED_LISTS.has(key);
}

/** An edit left open longer than this (closed browser, lost connection) no longer blocks someone else from starting one. */
export const EDIT_SESSION_STALE_MS = 8 * 60 * 60 * 1000;

const EDIT_DENIED = "Editing controlled lists needs the Edit master lists and logs permission. An administrator can turn it on under Users & Roles.";

async function canEditMasterList(req: Request, key: ListKey): Promise<boolean> {
  if (!req.db || !req.user) return false;
  const access = await getUserAccessLevel(req.db, req.user, LISTS[key].resource);
  if (access !== "edit") return false;
  return roleHasPermission(req.db, req.user.roleName, CONTROLLED_LISTS_EDIT_PERMISSION);
}

/** Every change to a master list needs the permission and an Edit this person started. */
async function requireListWrite(req: Request, key: ListKey) {
  await requireLevel(req, key, "edit");
  if (!isLockedList(key)) return;
  if (!(await canEditMasterList(req, key))) throw AppError.forbidden(EDIT_DENIED);
  const row = await loadRow(req.db!, key);
  if (!row || row.editBy !== req.user!.id) throw AppError.forbidden(`Click Edit before changing ${LISTS[key].title}.`);
}

function revisionAfterEdits(key: ListKey, current: string, changes: Array<{ sheet: string; addr: string; next: string }>): string {
  let revision = current;
  const locks = revCells(key);
  for (const change of changes) {
    if (!locks.some((item) => item.sheet === change.sheet && item.addr === change.addr)) continue;
    const letter = revisionLetter(change.next === "blank" ? "" : change.next);
    if (letter) revision = letter;
  }
  return revision;
}

async function loadRow(db: Db, key: ListKey) {
  const [row] = await db.select().from(controlledLists).where(eq(controlledLists.listKey, key));
  return row ?? null;
}

async function repairStoredHeader(db: Db, key: ListKey, row: { id: number; revision: string; sheets: StoredSheet[] }, userId: number) {
  const restored = restoreHeaderBlock(key, row.sheets);
  const revision = coalesceRevision(row.revision, LISTS[key].revision);
  if (!restored.changed && revision === row.revision) return row;
  await db
    .update(controlledLists)
    .set({ sheets: restored.sheets, revision, updatedAt: new Date() })
    .where(eq(controlledLists.id, row.id));
  const who = await personName(db, userId);
  const spec = LISTS[key];
  const revisionNote = revision === row.revision ? `Revision stayed ${revision}` : `Revision was blank and is now ${revision}`;
  await recordAuditTrail(db, {
    entityType: "ControlledList",
    entityId: row.id,
    action: "update",
    performedBy: userId,
    changes: {
      summary: `${who} restored the header block on ${spec.docId} from the controlled workbook. Blank header cells and missing header merges were filled back in. Edited header values were left as saved. ${revisionNote}.`,
    },
  });
  return { ...row, sheets: restored.sheets, revision };
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

// Blank Calibration placeholders (see PLACEHOLDER_EQUIPMENT_NAMES) are not added to the Master Equipment List.
export function isPlaceholderEquipment(item: { name: string | null; serialNumber?: string | null; metadata?: unknown }, hasEvents: boolean): boolean {
  if (hasEvents || item.serialNumber?.trim()) return false;
  const metadata = (item.metadata ?? {}) as Record<string, unknown>;
  if (typeof metadata.assetId === "string" && metadata.assetId.trim()) return false;
  return PLACEHOLDER_EQUIPMENT_NAMES.has((item.name ?? "").trim().toLowerCase());
}

async function equipmentAppends(db: Db) {
  const items = await db.select().from(equipment);
  const events = await db.execute<{ equipment_id: number; performed_at: Date | string | null }>(sql`
    SELECT DISTINCT ON (equipment_id) equipment_id, performed_at
    FROM calibrations
    WHERE performed_at IS NOT NULL
    ORDER BY equipment_id, performed_at DESC
  `);
  const latest = new Map<number, string>();
  for (const event of events.rows) {
    if (!event.performed_at) continue;
    latest.set(event.equipment_id, new Date(event.performed_at).toISOString().slice(0, 10));
  }
  return items.filter((item) => !isPlaceholderEquipment(item, latest.has(item.id))).map((item) => {
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
    const live = await db.select({ id: equipment.id }).from(equipment);
    const cleared = dropPlaceholderEquipmentRows(current, new Set(live.map((item) => String(item.id))));
    if (cleared.removed.length > 0) {
      current = cleared.sheets;
      await db.update(controlledLists).set({ sheets: current, updatedAt: new Date() }).where(eq(controlledLists.id, listId));
      await recordAuditTrail(db, {
        entityType: "ControlledList",
        entityId: listId,
        action: "update",
        changes: {
          summary: `System migration 0138_remove_placeholder_equipment removed ${cleared.removed.length} blank calibration placeholder rows from ${LISTS[key].docId}: ${cleared.removed.join(", ")}. Their equipment records were removed by the migration. Revision stayed ${LISTS[key].revision}.`,
          removed: cleared.removed,
        },
      });
    }
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
      named.linkedPath = spec.route;
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
  await collapseDuplicateLivingListNodes(db, folders, userId);
}

/**
 * One folder row per living list. A second row with the same route, left
 * behind when two copies of a drawer were folded together, is removed.
 * The shallower row stays, so the path is the drawer plus the list name.
 */
export async function collapseDuplicateLivingListNodes<T extends { id: number; name: string; parentId: number | null; linkedPath?: string | null }>(
  db: Db,
  folders: T[],
  performedBy?: number,
): Promise<T[]> {
  const routes = new Set(Object.values(LISTS).map((spec) => spec.route));
  let current = folders;
  for (const route of routes) {
    const matches = current.filter((folder) => folder.linkedPath === route);
    if (matches.length < 2) continue;
    const byId = new Map(current.map((folder) => [folder.id, folder]));
    const depthOf = (id: number) => {
      let depth = 0;
      let cursor = byId.get(id);
      const seen = new Set<number>();
      while (cursor && !seen.has(cursor.id)) {
        seen.add(cursor.id);
        if (cursor.parentId == null) break;
        depth += 1;
        cursor = byId.get(cursor.parentId);
      }
      return depth;
    };
    const ranked = [...matches].sort((a, b) => depthOf(a.id) - depthOf(b.id) || a.id - b.id);
    const keeper = ranked[0];
    if (!keeper) continue;
    for (const extra of ranked.slice(1)) {
      // A different document may point at the same page. Only a second copy of this list is removed.
      if (extra.name !== keeper.name) continue;
      if (current.some((folder) => folder.parentId === extra.id)) continue;
      await db.delete(documentFolders).where(eq(documentFolders.id, extra.id));
      current = current.filter((folder) => folder.id !== extra.id);
      await recordAuditTrail(db, {
        entityType: "DocumentFolder",
        entityId: extra.id,
        action: "delete",
        performedBy,
        changes: {
          summary: `Removed the extra ${extra.name} filing. The list stays at ${keeper.name}.`,
          name: extra.name,
          linkedPath: route,
          keptId: keeper.id,
        },
      });
    }
  }
  return current;
}

async function canEditDocuments(req: Request): Promise<boolean> {
  if (!req.db || !req.user) return false;
  return (await getUserAccessLevel(req.db, req.user, "documents")) === "edit";
}

async function listRetireStamp(db: Db): Promise<string> {
  const result = await db.execute<{ stamp: string }>(sql`
    SELECT concat_ws('|',
      (SELECT coalesce(max(id)::text, '0') FROM documents),
      (SELECT coalesce(max(id)::text, '0') FROM document_folders),
      (SELECT coalesce(max(id)::text, '0') FROM controlled_form_templates)
    ) AS stamp
  `);
  return String(result.rows[0]?.stamp ?? "");
}

/** True when an old list upload, blank, or document copy is still in the database. */
async function supersededListsNeedRetire(db: Db): Promise<boolean> {
  const found = await db.execute<{ hit: number }>(sql`
    SELECT 1 AS hit FROM (
      SELECT 1 FROM controlled_form_templates
      WHERE form_key IN ('lst-eqp-001', 'lst-gen-001', 'lst-gen-003', 'lst-eng-001', 'lst-gen-002')
         OR upper(form_id) IN ('LST-EQP-001', 'LST-GEN-001', 'LST-GEN-003', 'LST-DEV-001', 'LST-GEN-002', 'LST-ENG-001')
         OR lower(regexp_replace(title, '\\.(xlsx|xls|xlsm|pdf|docx)$', '', 'i')) IN (
           'master equipment list', 'master document list', 'scope of laboratory activities',
           'lst-dev-001', 'development log', 'development log (register)', 'lst-gen-002', 'internal audit schedule',
           'lst-eng-001', 'engineering request change log', 'ecr tracker', 'lst-eng-001 - ecr tracker - rev'
         )
      UNION ALL
      SELECT 1 FROM documents
      WHERE is_deleted = false
        AND lower(regexp_replace(title, '\\.(xlsx|xls|xlsm|pdf|docx)$', '', 'i')) IN (
          'master equipment list', 'master document list', 'scope of laboratory activities',
          'lst-dev-001', 'development log', 'development log (register)', 'internal audit schedule',
          'engineering request change log', 'ecr tracker'
        )
      UNION ALL
      SELECT 1 FROM document_folders
      WHERE pdf_path IS NOT NULL
        AND linked_path IN (
          '/calibration/master-list', '/documents/master-list', '/documents/laboratory-scope',
          '/documents/development-log', '/documents/internal-audit-schedule', '/documents/engineering-request-log'
        )
      UNION ALL
      SELECT 1 FROM document_folders
      WHERE lower(regexp_replace(name, '\\.(xlsx|xls|xlsm|pdf|docx)$', '', 'i')) IN (
          'master equipment list', 'master document list', 'scope of laboratory activities',
          'lst-dev-001', 'development log', 'development log (register)', 'lst-gen-002', 'internal audit schedule',
          'lst-eng-001', 'engineering request change log', 'ecr tracker', 'lst-eng-001 - ecr tracker - rev'
        )
        AND coalesce(linked_path, '') NOT IN (
          '/calibration/master-list', '/documents/master-list', '/documents/laboratory-scope',
          '/documents/development-log', '/documents/internal-audit-schedule', '/documents/engineering-request-log',
          '/documents/nonconformance-log'
        )
        AND (pdf_path IS NOT NULL OR document_id IS NOT NULL OR linked_path IS NULL OR linked_path !~ '/[0-9]+$')
    ) hits
    LIMIT 1
  `);
  return (found.rows ?? []).length > 0;
}

async function rememberListRetireStamp(db: Db, stamp: string): Promise<void> {
  const [row] = await db.select({ id: company.id, profile: company.profile }).from(company).limit(1);
  if (!row || row.profile?.supersededListsRetiredStamp === stamp) return;
  await db.update(company).set({ profile: { ...(row.profile ?? {}), supersededListsRetiredStamp: stamp } }).where(eq(company.id, row.id));
}

/** True when this open can skip the full document and folder scan. */
async function skipSupersededListRetire(db: Db): Promise<boolean> {
  const stamp = await listRetireStamp(db);
  const [row] = await db.select({ profile: company.profile }).from(company).limit(1);
  if (row?.profile?.supersededListsRetiredStamp === stamp) return true;
  if (await supersededListsNeedRetire(db)) return false;
  await rememberListRetireStamp(db, stamp);
  return true;
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
    if (!doc || !(titleMatchesList(doc.title) || titleMatchesDevLog(doc.title) || titleMatchesAuditSchedule(doc.title) || titleMatchesEngLog(doc.title))) continue;
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
  await ensureFormTemplates(req.db, undefined, { forcePrune: true });
}

async function requireLevel(req: Request, key: ListKey, level: "read" | "edit") {
  if (!req.db || !req.user) throw AppError.unauthorized("Not signed in");
  const access = await getUserAccessLevel(req.db, req.user, LISTS[key].resource);
  if (access === "none" || (level === "edit" && access !== "edit")) {
    throw AppError.forbidden(`You don't have permission to ${level === "edit" ? "edit" : "open"} ${LISTS[key].title}.`);
  }
}

/** Header repair and outside-row absorb for the list being opened. Other lists stay as they are. */
async function refreshOpenedList(req: Request, key: ListKey, row: { id: number; revision: string; sheets: StoredSheet[] }) {
  if (!req.db || !req.user) return row;
  const repaired = await repairStoredHeader(req.db, key, row, req.user.id);
  const absorbed = await absorbOutsideRows(req.db, key, repaired.sheets, req.user.id, repaired.id);
  const cleaned = dropEmptyDataRows(key, absorbed);
  if (cleaned.removed.length === 0) return absorbed === repaired.sheets ? repaired : { ...repaired, sheets: absorbed };
  await req.db.update(controlledLists).set({ sheets: cleaned.sheets, updatedAt: new Date() }).where(eq(controlledLists.id, repaired.id));
  const counts = cleaned.removed.map((item) => `${item.rows} on ${item.sheet.trim()}`).join(", ");
  await recordAuditTrail(req.db, {
    entityType: "ControlledList",
    entityId: repaired.id,
    action: "update",
    performedBy: req.user.id,
    changes: { summary: `Removed empty rows with no data (formula-only or blank after the last entry): ${counts}. Revision stayed ${repaired.revision}.`, removed: cleaned.removed },
  });
  return { ...repaired, sheets: cleaned.sheets };
}

export async function openControlledList(req: Request, key: ListKey): Promise<ControlledListView> {
  await requireLevel(req, key, "read");
  const existing = await loadRow(req.db!, key);
  // A list that already exists does not need every other list, the folder tree,
  // and the blank-form filing pass. That serial walk is what held the page on Loading.
  // Old Quality Manual copies are still retired here. Opening the list is what removes them.
  if (existing) {
    const refreshed = await refreshOpenedList(req, key, existing);
    if (!(await skipSupersededListRetire(req.db!))) {
      if (await canEditDocuments(req)) {
        await retireSupersededLists(req);
        await rememberListRetireStamp(req.db!, await listRetireStamp(req.db!));
      }
    }
    return present(req, key, refreshed);
  }
  await ensureLivingControlledLists(req);
  const row = await loadRow(req.db!, key);
  if (!row) throw AppError.notFound(LISTS[key].title);
  return present(req, key, row);
}

/** Only the first visit creates the lists; a save does not re-run the whole list/folder/template pass. */
/**
 * Edits used to rebuild all seven lists, re-file every folder and re-prune
 * the form templates on each save, which made typing in a list lag.
 * An existing list now only gets the superseded-copy cleanup.
 */
async function ensureListExists(req: Request, key: ListKey): Promise<void> {
  if (!(await loadRow(req.db!, key))) {
    await ensureLivingControlledLists(req);
    return;
  }
  await retireSupersededLists(req);
}

export async function saveControlledList(req: Request, key: ListKey, patches: Array<{ name: string; cells: Record<string, CellPatch> }>): Promise<ControlledListView> {
  await requireListWrite(req, key);
  await ensureListExists(req, key);
  const row = await loadRow(req.db!, key);
  if (!row) throw AppError.notFound(LISTS[key].title);
  const applied = applyInputPatch(key, row.sheets, patches);
  if (applied.changes.length === 0) return present(req, key, row);
  const revision = revisionAfterEdits(key, row.revision, applied.changes);
  const [updated] = await req
    .db!.update(controlledLists)
    .set({ sheets: applied.sheets, revision, updatedAt: new Date() })
    .where(eq(controlledLists.id, row.id))
    .returning();
  if (!updated) throw AppError.notFound(LISTS[key].title);
  const { who, when } = await acted(req.db!, req.user!.id);
  const stayed = revision === row.revision ? ` Revision stayed ${revision}.` : ` Revision is now ${revision}.`;
  await recordAuditTrail(req.db!, {
    entityType: "ControlledList",
    entityId: row.id,
    action: "update",
    performedBy: req.user!.id,
    changes: { summary: `${changeSummary(who, applied.changes, when)}${stayed}`, cells: applied.changes, revision },
  });
  return present(req, key, { ...updated, revision });
}

/** Puts the list's current folder path into Location cells. Does nothing until this is called. */
export async function insertControlledListLocation(req: Request, key: ListKey, sheetName: string, path: string): Promise<ControlledListView> {
  await requireListWrite(req, key);
  const trimmed = path.trim();
  if (!trimmed) throw AppError.badRequest("The folder path is empty.");
  if (trimmed.length > 500) throw AppError.badRequest("That path is too long.");
  await ensureListExists(req, key);
  const row = await loadRow(req.db!, key);
  if (!row) throw AppError.notFound(LISTS[key].title);
  const sheet = row.sheets.find((item) => item.name === sheetName);
  if (!sheet) throw AppError.badRequest("Choose a sheet.");
  const applied = insertLocationPath(key, row.sheets, sheetName, trimmed);
  if (applied.changes.length === 0) return present(req, key, row);
  const [updated] = await req.db!.update(controlledLists).set({ sheets: applied.sheets, updatedAt: new Date() }).where(eq(controlledLists.id, row.id)).returning();
  if (!updated) throw AppError.notFound(LISTS[key].title);
  const { who, when } = await acted(req.db!, req.user!.id);
  await recordAuditTrail(req.db!, {
    entityType: "ControlledList",
    entityId: row.id,
    action: "update",
    performedBy: req.user!.id,
    changes: {
      summary: `${who} inserted the folder path into Location on ${sheetName} on ${when}. Revision stayed ${row.revision}.`,
      cells: applied.changes,
      revision: row.revision,
    },
  });
  return present(req, key, { ...updated, revision: row.revision });
}

export async function changeControlledListRows(
  req: Request,
  key: ListKey,
  sheetName: string,
  op: "add" | "delete" | "insert",
  row?: number,
  rows?: number[],
  place?: "above" | "below",
): Promise<ControlledListView> {
  await requireListWrite(req, key);
  await ensureListExists(req, key);
  const current = await loadRow(req.db!, key);
  if (!current) throw AppError.notFound(LISTS[key].title);
  const { who, when } = await acted(req.db!, req.user!.id);
  let sheets = current.sheets;
  let summary = "";
  if (op === "add") {
    const added = addDataRow(key, sheets, sheetName);
    if (!added) throw AppError.badRequest("That sheet does not take new rows.");
    sheets = added.sheets;
    summary = rowSummary(who, "added", sheetName, added.row, undefined, when);
  } else if (op === "insert") {
    if (row == null) throw AppError.badRequest("Choose a row.");
    const at = place === "below" ? row + 1 : row;
    const inserted = insertDataRow(key, sheets, sheetName, at);
    if (!inserted) throw AppError.badRequest("Choose a data row.");
    sheets = inserted.sheets;
    summary = rowSummary(who, "inserted", sheetName, inserted.row, undefined, when);
  } else {
    const targets = rows && rows.length > 0 ? rows : row == null ? [] : [row];
    if (targets.length === 0) throw AppError.badRequest("Choose a row to delete.");
    const sheet = current.sheets.find((item) => item.name === sheetName);
    if (!sheet) throw AppError.badRequest("Choose a sheet.");
    const described = [...new Set(targets)].sort((a, b) => a - b).map((line) => {
      const label = sheet.cells[`A${line}`]?.v;
      return { row: line, label: typeof label === "string" ? label : undefined, values: rowValueList(sheet, line) };
    });
    const removed = removeDataRows(key, sheets, sheetName, targets);
    if (!removed) throw AppError.badRequest("That row is part of the header.");
    sheets = removed;
    summary = rowsDeletedSummary(who, sheetName, described, when);
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
  return present(req, key, { ...updated, revision: current.revision });
}

const STRUCTURE_DENIED = "Adding, renaming, or removing a column changes the list structure. An administrator can turn that on with Can build forms under Users & Roles.";

export async function changeControlledListColumns(
  req: Request,
  key: ListKey,
  sheetName: string,
  op: "add" | "rename" | "remove",
  col?: string,
  name?: string,
): Promise<ControlledListView> {
  await requireListWrite(req, key);
  if (!(await structureAllowed(req))) throw AppError.forbidden(STRUCTURE_DENIED);
  await ensureListExists(req, key);
  const current = await loadRow(req.db!, key);
  if (!current) throw AppError.notFound(LISTS[key].title);
  const edited =
    op === "add"
      ? addListColumn(key, current.sheets, current.revision, sheetName, col ?? null)
      : op === "rename"
        ? renameListColumn(key, current.sheets, current.revision, sheetName, col ?? "", name ?? "")
        : removeListColumn(key, current.sheets, current.revision, sheetName, col ?? "");
  if (!edited) throw AppError.badRequest("That column could not be changed.");
  if (!edited.bumped) return present(req, key, current);
  // Rev is never changed by a column edit; edited.revision is the current one.
  const [updated] = await req
    .db!.update(controlledLists)
    .set({ sheets: edited.sheets, revision: edited.revision, updatedAt: new Date() })
    .where(eq(controlledLists.id, current.id))
    .returning();
  if (!updated) throw AppError.notFound(LISTS[key].title);
  const { who, when } = await acted(req.db!, req.user!.id);
  await recordAuditTrail(req.db!, {
    entityType: "ControlledList",
    entityId: current.id,
    action: "update",
    performedBy: req.user!.id,
    changes: { summary: structureSummary(who, edited.detail, current.revision, edited.revision, when), revision: edited.revision },
  });
  return present(req, key, updated);
}

export async function downloadControlledList(req: Request, key: ListKey): Promise<{ filename: string; body: Buffer }> {
  const opened = await openControlledList(req, key);
  return { filename: workbookFileName(key), body: await buildListWorkbook(key, opened.sheets) };
}

function cellText(value: unknown): string {
  return value == null ? "" : String(value);
}

/** Plain summary of what changed between Edit and Save, per sheet. */
export function editSessionSummary(before: StoredSheet[], after: StoredSheet[]): string {
  const parts: string[] = [];
  for (const sheet of after) {
    const old = before.find((item) => item.name === sheet.name);
    if (!old) continue;
    const addrs = new Set([...Object.keys(old.cells), ...Object.keys(sheet.cells)]);
    let changed = 0;
    for (const addr of addrs) if (cellText(old.cells[addr]?.v) !== cellText(sheet.cells[addr]?.v)) changed += 1;
    const rows = sheet.maxRow - old.maxRow;
    const bits: string[] = [];
    if (changed > 0) bits.push(`${changed} cell${changed === 1 ? "" : "s"} changed`);
    if (rows > 0) bits.push(`${rows} row${rows === 1 ? "" : "s"} added`);
    if (rows < 0) bits.push(`${-rows} row${rows === -1 ? "" : "s"} removed`);
    if (bits.length > 0) parts.push(`${sheet.name.trim()}: ${bits.join(", ")}`);
  }
  return parts.length > 0 ? parts.join("; ") : "no changes";
}

/** Edit, Save and Cancel for a master list. Each one is recorded in the audit trail. */
export async function editControlledList(req: Request, key: ListKey, action: "start" | "save" | "cancel"): Promise<ControlledListView> {
    await requireLevel(req, key, "edit");
  if (!(await canEditMasterList(req, key))) throw AppError.forbidden(EDIT_DENIED);
  await ensureListExists(req, key);
  const row = await loadRow(req.db!, key);
  if (!row) throw AppError.notFound(LISTS[key].title);
  const db = req.db!;
  const userId = req.user!.id;
  const title = LISTS[key].title === LISTS[key].docId ? LISTS[key].docId : `${LISTS[key].docId} ${LISTS[key].title}`;
  const { who, when } = await acted(db, userId);
  const clear = { editSnapshot: null, editRevision: null, editBy: null, editStartedAt: null };
  if (action === "start") {
    if (row.editBy === userId) return present(req, key, row);
    const fresh = row.editStartedAt && Date.now() - row.editStartedAt.getTime() < EDIT_SESSION_STALE_MS;
    if (row.editBy != null && fresh) {
      throw new AppError(`${await personName(db, row.editBy)} is editing ${LISTS[key].title}. Try again after they save or cancel.`, 409);
    }
    const [updated] = await db
      .update(controlledLists)
      .set({ editSnapshot: row.sheets, editRevision: row.revision, editBy: userId, editStartedAt: new Date() })
      .where(eq(controlledLists.id, row.id))
      .returning();
    await recordAuditTrail(db, {
      entityType: "ControlledList",
      entityId: row.id,
      action: "update",
      performedBy: userId,
      changes: { summary: `${who} started editing ${title} on ${when}. Revision ${row.revision}.` },
    });
    return present(req, key, updated!);
  }
  if (row.editBy !== userId) throw AppError.forbidden(`You do not have ${LISTS[key].title} open for editing.`);
  if (action === "save") {
    const summary = editSessionSummary(row.editSnapshot ?? row.sheets, row.sheets);
    const [updated] = await db.update(controlledLists).set(clear).where(eq(controlledLists.id, row.id)).returning();
    await recordAuditTrail(db, {
      entityType: "ControlledList",
      entityId: row.id,
      action: "update",
      performedBy: userId,
      changes: { summary: `${who} saved edits to ${title} on ${when}: ${summary}. Revision ${row.revision}. The list is locked again.` },
    });
    return present(req, key, updated!);
  }
  const discarded = editSessionSummary(row.editSnapshot ?? row.sheets, row.sheets);
  const restored = { sheets: row.editSnapshot ?? row.sheets, revision: row.editRevision ?? row.revision };
  const [updated] = await db
    .update(controlledLists)
    .set({ ...restored, ...clear, updatedAt: new Date() })
    .where(eq(controlledLists.id, row.id))
    .returning();
  await recordAuditTrail(db, {
    entityType: "ControlledList",
    entityId: row.id,
    action: "update",
    performedBy: userId,
    changes: { summary: `${who} canceled editing ${title} on ${when}. Discarded: ${discarded}. Revision ${restored.revision}. The list is locked again.` },
  });
  return present(req, key, updated!);
}
