import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { env } from "../../config/env.js";
import { attachments } from "../../drizzle/schema/attachments.js";
import type { ExtractedImage } from "../form-import/extract.js";
import { REPORT_IMAGES_ENTITY, sectionKeyForHeading, type ReportImage } from "./model.js";

/** Same folder and file naming as the generic attachment upload (attachments.controller.ts). */
async function writeAttachmentFile(fileName: string, bytes: Buffer, serial: number): Promise<string> {
  const dir = `${env.STORAGE_LOCAL_PATH}/attachments`;
  await mkdir(dir, { recursive: true });
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${dir}/${Date.now()}-${serial}-${safeName}`;
  await writeFile(path, bytes);
  return path;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Removes the attachment rows and their files. A missing file on disk never blocks the delete. */
export async function deleteReportImageFiles(db: Db, reportId: number, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.entityType, REPORT_IMAGES_ENTITY), eq(attachments.entityId, reportId), inArray(attachments.id, ids)));
  if (rows.length === 0) return;
  await db.delete(attachments).where(inArray(attachments.id, rows.map((row) => row.id)));
  for (const row of rows) await unlink(row.filePath).catch(() => {});
}

export interface StoredImages {
  images: ReportImage[];
  added: number;
  removed: number;
  duplicates: number;
}

/**
 * Saves the imported pictures as attachments of this report and returns the report's new picture list.
 * Replace off: keeps what is there, adds only pictures not already stored (same sha256).
 * Replace on: removes the previously stored pictures (rows and files) and stores this set.
 */
export async function storeReportImages(
  db: Db,
  input: { reportId: number; images: ExtractedImage[]; existing: ReportImage[]; replace: boolean; uploadedBy: number },
): Promise<StoredImages> {
  let keep = input.existing;
  let removed = 0;
  if (input.replace && input.images.length > 0) {
    await deleteReportImageFiles(db, input.reportId, keep.map((image) => image.attachmentId));
    removed = keep.length;
    keep = [];
  }
  const known = new Set(keep.map((image) => image.sha256).filter(Boolean));
  let nextOrder = keep.reduce((max, image) => Math.max(max, image.order), 0);
  const stored: ReportImage[] = [];
  let duplicates = 0;
  let serial = 0;
  for (const image of input.images) {
    const hash = sha256(image.bytes);
    if (known.has(hash)) {
      duplicates += 1;
      continue;
    }
    known.add(hash);
    serial += 1;
    const path = await writeAttachmentFile(image.fileName, image.bytes, serial);
    const [row] = await db
      .insert(attachments)
      .values({
        entityType: REPORT_IMAGES_ENTITY,
        entityId: input.reportId,
        fileName: image.fileName,
        filePath: path,
        mimeType: image.mimeType,
        fileSize: image.bytes.length,
        uploadedBy: input.uploadedBy,
      })
      .returning();
    nextOrder += 1;
    stored.push({ attachmentId: row!.id, section: image.section, sectionKey: sectionKeyForHeading(image.section), order: nextOrder, caption: image.caption, fileName: image.fileName, sha256: hash });
  }
  return { images: [...keep, ...stored], added: stored.length, removed, duplicates };
}

export interface ReportImageFile {
  image: ReportImage;
  mimeType: string;
  bytes: Buffer;
}

/** The stored bytes of this report's pictures, in picture order. A picture whose file is gone is left out. */
export async function loadReportImageFiles(db: Db, reportId: number, images: ReportImage[]): Promise<ReportImageFile[]> {
  if (images.length === 0) return [];
  const rows = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.entityType, REPORT_IMAGES_ENTITY), eq(attachments.entityId, reportId), inArray(attachments.id, images.map((image) => image.attachmentId))));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const out: ReportImageFile[] = [];
  for (const image of [...images].sort((a, b) => a.order - b.order)) {
    const row = byId.get(image.attachmentId);
    if (!row || !existsSync(row.filePath)) continue;
    out.push({ image, mimeType: row.mimeType ?? "application/octet-stream", bytes: await readFile(row.filePath) });
  }
  return out;
}
