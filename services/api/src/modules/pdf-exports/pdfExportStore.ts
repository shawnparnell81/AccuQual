import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { env } from "../../config/env.js";
import { pdfExports, type PdfExport } from "../../drizzle/schema/pdfExports.js";
import { documents } from "../../drizzle/schema/documents.js";
import { users } from "../../drizzle/schema/users.js";
import { AppError } from "../../utils/appError.js";
import type { ControlledPdfFrame } from "../forms/controlledPdf.js";
import { newExportId } from "../forms/controlledPdf.js";
import { verifyUrlFor } from "../forms/verifyLink.js";
import { markingFromRecord, type RecordMarking } from "./recordMarking.js";
import { isOnLegalHold } from "./legalHold.js";

export const PDF_RENDERER = "accuqual-form-layout";

export interface PdfChrome {
  exportId: string;
  legalHold: boolean;
  marking: RecordMarking | null;
  verifyUrl: string;
}

export async function loadPdfChrome(db: Db, entityType: string | null, entityId: number | null, data: unknown): Promise<PdfChrome> {
  const exportId = newExportId();
  let marking = markingFromRecord(data);
  if (!marking && entityType === "document" && entityId != null) {
    const [doc] = await db.select({ tags: documents.tags }).from(documents).where(eq(documents.id, entityId)).limit(1);
    marking = markingFromRecord({ tags: doc?.tags ?? [] });
  }
  const legalHold = entityType != null && entityId != null ? await isOnLegalHold(db, entityType, entityId) : false;
  return { exportId, legalHold, marking, verifyUrl: verifyUrlFor(exportId) };
}

export function applyChrome(frame: ControlledPdfFrame, chrome: PdfChrome): ControlledPdfFrame {
  return {
    ...frame,
    exportId: chrome.exportId,
    legalHold: chrome.legalHold,
    marking: chrome.marking,
    verifyUrl: chrome.verifyUrl,
  };
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function checksumMatchesFile(filePath: string, sha256: string): Promise<boolean> {
  if (!existsSync(filePath)) return false;
  const stored = await readFile(filePath);
  return sha256Of(stored) === sha256;
}

function exportDir(): string {
  return `${env.STORAGE_LOCAL_PATH}/attachments/pdf-exports`;
}

/** Writes a new file. A path that already exists is left alone. */
export async function writeExportFile(exportId: string, bytes: Uint8Array): Promise<{ filePath: string; sha256: string; fileSize: number }> {
  if (!/^exp_[0-9a-f-]{36}$/i.test(exportId)) throw AppError.badRequest("Invalid export id");
  const dir = exportDir();
  await mkdir(dir, { recursive: true });
  const filePath = `${dir}/${exportId}.pdf`;
  if (existsSync(filePath)) throw new AppError("That export file is already stored.", 409);
  await writeFile(filePath, bytes);
  return { filePath, sha256: sha256Of(bytes), fileSize: bytes.byteLength };
}

export async function persistPdfExport(
  db: Db,
  bytes: Uint8Array,
  frame: ControlledPdfFrame,
  meta: { entityType: string | null; entityId: number | null; actorId?: number; renderer?: string },
): Promise<PdfExport> {
  const written = await writeExportFile(frame.exportId, bytes);
  try {
    const [row] = await db
      .insert(pdfExports)
      .values({
        exportId: frame.exportId,
        sourceModule: frame.sourceModule,
        entityType: meta.entityType,
        entityId: meta.entityId,
        recordNumber: frame.recordNumber,
        revision: frame.revision,
        recordStatus: frame.status ?? null,
        sha256: written.sha256,
        fileSize: written.fileSize,
        mimeType: "application/pdf",
        renderer: meta.renderer ?? PDF_RENDERER,
        filePath: written.filePath,
        generatedBy: meta.actorId,
        generatedAt: frame.generatedAt,
      })
      .returning();
    return row!;
  } catch (err) {
    await unlink(written.filePath).catch(() => undefined);
    throw err;
  }
}

export async function findExport(db: Db, exportId: string): Promise<PdfExport | undefined> {
  const [row] = await db.select().from(pdfExports).where(eq(pdfExports.exportId, exportId)).limit(1);
  return row;
}

export async function generatedByName(db: Db, userId: number | null): Promise<string> {
  if (userId == null) return "";
  const [row] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.name?.trim() || "";
}

export async function markExportFiled(db: Db, exportId: string, patch: { documentId?: number | null; folderId?: number | null; attachmentId?: number | null }) {
  await db
    .update(pdfExports)
    .set({
      ...(patch.documentId !== undefined ? { documentId: patch.documentId } : {}),
      ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
      ...(patch.attachmentId !== undefined ? { attachmentId: patch.attachmentId } : {}),
    })
    .where(and(eq(pdfExports.exportId, exportId)));
}
