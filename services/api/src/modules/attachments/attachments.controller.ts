import type { Request, Response } from "express";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { and, desc, eq, isNull } from "drizzle-orm";
import { attachments } from "../../drizzle/schema/attachments.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { env } from "../../config/env.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";

/**
 * ONE generic upload/list/download/delete surface reused by every module —
 * see attachments.ts's own schema comment. No department gate: any
 * authenticated company user may upload, view, and download; delete is
 * restricted to the uploader or an admin (see deleteAttachmentHandler).
 * Same multer memoryStorage + STORAGE_LOCAL_PATH pattern as forms'
 * uploadTemplateHandler and document-folders' uploadTemplate.
 */
export const uploadAttachmentHandler = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) throw AppError.badRequest("No file uploaded");

  const entityType = (req.body.entityType as string | undefined) || null;
  const entityId = req.body.entityId ? Number(req.body.entityId) : null;
  if ((entityType && entityId === null) || (!entityType && entityId !== null)) {
    throw AppError.badRequest("entityType and entityId must be provided together, or both omitted for a general upload");
  }

  const dir = `${env.STORAGE_LOCAL_PATH}/attachments`;
  await mkdir(dir, { recursive: true });
  const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${dir}/${Date.now()}-${safeName}`;
  await writeFile(path, file.buffer);

  const [created] = await req
    .db!.insert(attachments)
    .values({ entityType, entityId, fileName: file.originalname, filePath: path, mimeType: file.mimetype, fileSize: file.size, uploadedBy: req.user?.id })
    .returning();

  await recordAuditTrail(req.db!, {
    entityType: "Attachment",
    entityId: created!.id,
    action: "create",
    changes: { fileName: file.originalname, attachedTo: entityType ? `${entityType}#${entityId}` : "general upload" },
    performedBy: req.user?.id,
  });
  res.status(201).json(created);
});

/**
 * GET /attachments?entityType=X&entityId=Y — that record's own evidence.
 * GET /attachments (no query) — the shared "General Uploads" bin (both
 * entityType/entityId null), not a per-user private list — same "shared QMS
 * records, not personal silos" spirit as the rest of the app.
 */
export const listAttachmentsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { entityType, entityId } = req.query as Record<string, string | undefined>;

  const conditions = [];
  if (entityType && entityId) {
    conditions.push(eq(attachments.entityType, entityType), eq(attachments.entityId, Number(entityId)));
  } else {
    conditions.push(isNull(attachments.entityType));
  }

  const rows = await req.db!.select().from(attachments).where(and(...conditions)).orderBy(desc(attachments.createdAt));
  res.json(rows);
});

export const downloadAttachmentHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [row] = await req.db!.select().from(attachments).where(and(eq(attachments.id, id)));
  if (!row) throw AppError.notFound("Attachment");
  if (!existsSync(row.filePath)) throw AppError.notFound("Attachment file");

  res.setHeader("Content-Type", row.mimeType ?? "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(row.fileName)}"`);
  createReadStream(row.filePath).pipe(res);
});

/** Uploader or admin only — same "you own what you uploaded, or you're an admin" rule as most delete actions in this app. */
export const deleteAttachmentHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [row] = await req.db!.select().from(attachments).where(and(eq(attachments.id, id)));
  if (!row) throw AppError.notFound("Attachment");

  const role = req.user?.roleName;
  const isAdmin = role === "admin";
  if (!isAdmin && row.uploadedBy !== req.user?.id) throw AppError.forbidden("Only the uploader or an admin can delete this attachment.");

  await req.db!.delete(attachments).where(eq(attachments.id, id));
  await unlink(row.filePath).catch(() => {}); // best-effort — the DB row is the source of truth, a missing file on disk shouldn't block the delete
  await recordAuditTrail(req.db!, { entityType: "Attachment", entityId: id, action: "delete", changes: { fileName: row.fileName }, performedBy: req.user?.id });
  res.status(204).send();
});
