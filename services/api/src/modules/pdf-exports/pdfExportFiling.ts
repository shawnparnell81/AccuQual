import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import type { Request } from "express";
import type { Db } from "../../lib/requestDb.js";
import { env } from "../../config/env.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import { documents } from "../../drizzle/schema/documents.js";
import { attachments } from "../../drizzle/schema/attachments.js";
import type { PdfExport } from "../../drizzle/schema/pdfExports.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { assertAttachmentAudience, attachmentTarget } from "../attachments/attachmentAccess.js";
import { blankDocumentPayload } from "../documents/documentPayload.js";
import { addAttachment, documentAdapter } from "../documents/documentVersioning.js";
import { attachUploadedFile } from "../document-folders/document-folders.controller.js";
import * as engine from "../versioning/versioning.service.js";
import { checksumMatchesFile, markExportFiled, sha256Of } from "./pdfExportStore.js";
import { assertCanReadExport } from "./pdfExportAccess.js";

const BLANK_LIBRARY = "Blank Form Templates";

function cleanTitle(value: string): string {
  const trimmed = value.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return (trimmed || "Exported PDF").slice(0, 180);
}

async function readExactPdf(row: PdfExport): Promise<Buffer> {
  const matches = await checksumMatchesFile(row.filePath, row.sha256);
  if (!matches) throw new AppError("The stored PDF no longer matches its checksum.", 409);
  return readFile(row.filePath);
}

async function folderIsBlankLibrary(db: Db, folderId: number): Promise<boolean> {
  const folders = await db.select({ id: documentFolders.id, name: documentFolders.name, parentId: documentFolders.parentId }).from(documentFolders);
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let current = byId.get(folderId);
  const seen = new Set<number>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.name === BLANK_LIBRARY) return true;
    current = current.parentId == null ? undefined : byId.get(current.parentId);
  }
  return false;
}

/** Files the exact stored bytes into Document Control: a draft document plus a folder file. */
export async function fileExportIntoFolder(req: Request, row: PdfExport, folderId: number, name?: string) {
  const db = req.db!;
  await assertCanReadExport(req, row);
  if (!Number.isInteger(folderId) || folderId < 1) throw AppError.badRequest("Pick a folder.");
  const [parent] = await db.select().from(documentFolders).where(eq(documentFolders.id, folderId));
  if (!parent) throw AppError.notFound("Document folder");
  if (await folderIsBlankLibrary(db, folderId)) throw AppError.badRequest("Blank Form Templates is for empty layouts. Pick a Documents folder.");

  const bytes = await readExactPdf(row);
  const title = cleanTitle(name || row.recordNumber || row.sourceModule);
  const fileName = `${title}.pdf`;
  const actor = { id: req.user!.id, roleName: req.user!.roleName ?? null };

  const [doc] = await db
    .insert(documents)
    .values({ title, category: null, status: "draft", currentVersion: 0, ownerId: actor.id })
    .returning();
  if (!doc) throw new AppError("Failed to create the document", 500);
  const draft = await engine.createInitialDraft(db, documentAdapter, doc.id, actor, { ...blankDocumentPayload(), title, category: null } as unknown as Record<string, unknown>);
  await addAttachment(db, doc.id, draft.id, actor, { originalname: fileName, buffer: bytes, size: bytes.length });
  await recordAuditTrail(db, { entityType: "Document", entityId: doc.id, action: "create", changes: { title, sourceExportId: row.exportId, sha256: row.sha256 }, performedBy: actor.id });

  const [folder] = await db.insert(documentFolders).values({ name: title, parentId: folderId, documentId: doc.id }).returning();
  if (!folder) throw new AppError("Failed to file the PDF", 500);
  await recordAuditTrail(db, { entityType: "DocumentFolder", entityId: folder.id, action: "create", changes: { name: title, parentId: folderId, documentId: doc.id }, performedBy: actor.id });
  const filed = await attachUploadedFile(db, folder.id, { originalname: fileName, buffer: bytes }, actor.id);
  await markExportFiled(db, row.exportId, { documentId: doc.id, folderId: filed.id });
  return { documentId: doc.id, folderId: filed.id, sha256: sha256Of(bytes) };
}

/** Copies the same bytes onto the source record through the attachments table. */
export async function attachExportToRecord(req: Request, row: PdfExport) {
  const db = req.db!;
  await assertCanReadExport(req, row);
  const target = attachmentTarget(row.entityType);
  if (!target || row.entityId == null) throw AppError.badRequest("This export is not tied to a record that can take attachments.");
  await assertAttachmentAudience(req, target, row.entityId);
  const bytes = await readExactPdf(row);
  const safe = (row.recordNumber || row.exportId).replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `${safe}.pdf`;
  const dir = `${env.STORAGE_LOCAL_PATH}/attachments`;
  await mkdir(dir, { recursive: true });
  const filePath = `${dir}/${Date.now()}-${row.exportId}.pdf`;
  await writeFile(filePath, bytes);
  let created: typeof attachments.$inferSelect | undefined;
  try {
    [created] = await db
      .insert(attachments)
      .values({
        entityType: target,
        entityId: row.entityId,
        fileName,
        filePath,
        mimeType: "application/pdf",
        fileSize: bytes.length,
        uploadedBy: req.user?.id,
      })
      .returning();
  } catch (err) {
    await unlink(filePath).catch(() => undefined);
    throw err;
  }
  await recordAuditTrail(db, {
    entityType: "Attachment",
    entityId: created!.id,
    action: "create",
    changes: { fileName, attachedTo: `${target}#${row.entityId}`, sourceExportId: row.exportId, sha256: sha256Of(bytes) },
    performedBy: req.user?.id,
  });
  await markExportFiled(db, row.exportId, { attachmentId: created!.id });
  return created!;
}
