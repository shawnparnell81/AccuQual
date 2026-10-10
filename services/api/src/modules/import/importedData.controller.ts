import { createReadStream } from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config/env.js";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import { dataImports } from "../../drizzle/schema/dataImports.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import { users } from "../../drizzle/schema/users.js";
import type { Db } from "../../lib/requestDb.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { optionalRows } from "../sites/optionalSql.js";
import { getCatalogEntry } from "./import.catalog.js";
import { IMPORT_ARCHIVE_UNAVAILABLE, removeFiledNode } from "./import.archive.js";
import { RETAILER_FIELDS } from "./import.retailer.js";

const reasonSchema = z.object({ reason: z.string().trim().min(1).max(500) });

function database(req: Request): Db {
  if (!req.db) throw AppError.unauthorized("Missing company context");
  return req.db;
}

function plantClause(req: Request) {
  if (req.allSites) return sql`true`;
  if (req.siteId == null) return sql`s.site_id IS NULL`;
  return sql`(s.site_id = ${req.siteId} OR s.site_id IS NULL)`;
}

interface SaveRow {
  id: number;
  import_id: number;
  display_name: string;
  entity_key: string;
  row_count: number;
  source_file_name: string;
  site_id: number | null;
  site_name: string | null;
  imported_by: string | null;
  created_at: string | null;
  deleted_at: string | null;
  delete_reason: string | null;
  folder_id: number | null;
  folder_node_id: number | null;
}

function presentSave(row: SaveRow) {
  const entry = getCatalogEntry(row.entity_key);
  return {
    id: row.import_id,
    saveId: row.id,
    name: row.display_name,
    entityKey: row.entity_key,
    type: entry?.label ?? row.entity_key,
    rowCount: row.row_count,
    sourceFileName: row.source_file_name,
    siteId: row.site_id,
    siteName: row.site_name,
    importedBy: row.imported_by,
    importedAt: row.created_at,
    deletedAt: row.deleted_at,
    deleteReason: row.delete_reason,
  };
}

const SAVE_SELECT = sql`
  SELECT s.id, s.import_id, s.display_name, s.entity_key, s.row_count, s.source_file_name,
         s.site_id, si.name AS site_name, COALESCE(u.name, u.email) AS imported_by,
         s.created_at, s.deleted_at, s.delete_reason, s.folder_id, s.folder_node_id
  FROM import_saves s
  LEFT JOIN users u ON u.id = s.saved_by
  LEFT JOIN sites si ON si.id = s.site_id
`;

export const listImportedData = asyncHandler(async (req: Request, res: Response) => {
  const db = database(req);
  const includeDeleted = req.query.deleted === "1";
  const deleted = includeDeleted ? sql`true` : sql`s.deleted_at IS NULL`;
  const rows = (await optionalRows<Record<string, unknown>>(db, sql`${SAVE_SELECT} WHERE ${deleted} AND ${plantClause(req)} ORDER BY s.created_at DESC`)) as SaveRow[] | null;
  if (rows == null) {
    res.json({ available: false, fields: RETAILER_FIELDS, rows: [] });
    return;
  }
  res.json({ available: true, fields: RETAILER_FIELDS, rows: rows.map(presentSave) });
});

async function loadSave(db: Db, importId: number): Promise<SaveRow> {
  const rows = (await optionalRows<Record<string, unknown>>(db, sql`${SAVE_SELECT} WHERE s.import_id = ${importId} LIMIT 1`)) as SaveRow[] | null;
  if (rows == null) throw new AppError(IMPORT_ARCHIVE_UNAVAILABLE, 503);
  const row = rows[0];
  if (!row) throw AppError.notFound("Import");
  return row;
}

function onPlant(req: Request, siteId: number | null): void {
  if (req.allSites) return;
  if (siteId == null) return;
  if (req.siteId != null && siteId !== req.siteId) throw AppError.notFound("Import");
}

export const getImportedData = asyncHandler(async (req: Request, res: Response) => {
  const db = database(req);
  const importId = Number(req.params.id);
  const save = await loadSave(db, importId);
  onPlant(req, save.site_id);
  const [job] = await db.select().from(dataImports).where(eq(dataImports.id, importId));
  const parsed = await optionalRows<{ row_number: number; cells: string[]; mapped: Record<string, string> }>(
    db,
    sql`SELECT row_number, cells, mapped FROM import_parsed_rows WHERE import_id = ${importId} ORDER BY row_number LIMIT 40`,
  );
  const history = await db
    .select({
      id: auditTrail.id,
      action: auditTrail.action,
      changes: auditTrail.changes,
      createdAt: auditTrail.createdAt,
      performedByName: users.name,
      performedByEmail: users.email,
    })
    .from(auditTrail)
    .leftJoin(users, eq(users.id, auditTrail.performedBy))
    .where(and(eq(auditTrail.entityType, "DataImport"), eq(auditTrail.entityId, importId)))
    .orderBy(desc(auditTrail.id));
  res.json({
    ...presentSave(save),
    headers: job?.headers ?? [],
    rows: parsed ?? [],
    audit: history.map((entry) => ({
      id: entry.id,
      action: entry.action,
      changes: entry.changes,
      createdAt: entry.createdAt,
      performedByName: entry.performedByName || entry.performedByEmail,
    })),
  });
});

export const downloadImportedFile = asyncHandler(async (req: Request, res: Response) => {
  const db = database(req);
  const importId = Number(req.params.id);
  const save = await loadSave(db, importId);
  onPlant(req, save.site_id);
  if (save.deleted_at) throw AppError.notFound("Import");
  const [job] = await db.select().from(dataImports).where(eq(dataImports.id, importId));
  if (!job?.filePath) throw AppError.notFound("File");
  const root = path.resolve(env.STORAGE_LOCAL_PATH) + path.sep;
  const stored = path.resolve(job.filePath);
  if (!stored.startsWith(root)) throw AppError.notFound("File");
  res.setHeader("Content-Type", job.mimeType || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(save.source_file_name || job.fileName)}"`);
  createReadStream(stored).pipe(res);
});

export const deleteImportedData = asyncHandler(async (req: Request, res: Response) => {
  const db = database(req);
  const parsed = reasonSchema.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest("Say why this import is being removed.");
  const importId = Number(req.params.id);
  const save = await loadSave(db, importId);
  onPlant(req, save.site_id);
  if (save.deleted_at) throw AppError.badRequest("This import is already removed.");
  await db.execute(sql`
    UPDATE import_saves
    SET deleted_at = now(), delete_reason = ${parsed.data.reason}, deleted_by = ${req.user?.id ?? null}, folder_node_id = NULL
    WHERE import_id = ${importId}
  `);
  await removeFiledNode(db, save.folder_node_id);
  await recordAuditTrail(db, {
    entityType: "DataImport",
    entityId: importId,
    action: "delete",
    changes: { reason: parsed.data.reason, displayName: save.display_name, fileName: save.source_file_name, type: presentSave(save).type },
    performedBy: req.user?.id,
  });
  res.json({ id: importId, deleted: true });
});

export const restoreImportedData = asyncHandler(async (req: Request, res: Response) => {
  const db = database(req);
  const parsed = reasonSchema.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest("Say why this import is being restored.");
  const importId = Number(req.params.id);
  const save = await loadSave(db, importId);
  onPlant(req, save.site_id);
  if (!save.deleted_at) throw AppError.badRequest("This import is not removed.");
  const [job] = await db.select().from(dataImports).where(eq(dataImports.id, importId));
  let nodeId: number | null = null;
  if (save.folder_id && job) {
    const [node] = await db
      .insert(documentFolders)
      .values({
        name: save.display_name,
        parentId: save.folder_id,
        sortOrder: 0,
        pdfPath: job.filePath,
        pdfMimeType: job.mimeType,
        linkedPath: `/reporting/imported-data/${importId}`,
      })
      .returning();
    nodeId = node?.id ?? null;
  }
  await db.execute(sql`
    UPDATE import_saves
    SET deleted_at = NULL, delete_reason = NULL, restored_at = now(), restore_reason = ${parsed.data.reason},
        restored_by = ${req.user?.id ?? null}, folder_node_id = ${nodeId}
    WHERE import_id = ${importId}
  `);
  await recordAuditTrail(db, {
    entityType: "DataImport",
    entityId: importId,
    action: "status_change",
    changes: { from: "deleted", to: "restored", reason: parsed.data.reason, displayName: save.display_name, fileName: save.source_file_name },
    performedBy: req.user?.id,
  });
  res.json({ id: importId, restored: true });
});
