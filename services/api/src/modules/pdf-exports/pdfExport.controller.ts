import type { Request, Response } from "express";
import { existsSync } from "node:fs";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { sendStoredFile } from "../../utils/storedFile.js";
import { getUserAccessLevel } from "../../middleware/departmentAccess.js";
import { findExport, checksumMatchesFile, generatedByName } from "./pdfExportStore.js";
import { attachmentTarget } from "../attachments/attachmentAccess.js";
import { assertCanReadExport } from "./pdfExportAccess.js";
import { attachExportToRecord, fileExportIntoFolder } from "./pdfExportFiling.js";
import { isOnLegalHold, placeLegalHold, releaseLegalHold } from "./legalHold.js";

function exportIdOf(req: Request): string {
  const exportId = String(req.params.exportId ?? "");
  if (!/^exp_[0-9a-f-]{36}$/i.test(exportId)) throw AppError.notFound("Export");
  return exportId;
}

async function loadReadable(req: Request) {
  const row = await findExport(req.db!, exportIdOf(req));
  if (!row) throw AppError.notFound("Export");
  await assertCanReadExport(req, row);
  return row;
}

/** Status of one stored export. Record number, revision, status, time, and checksum. Not the record body. */
export const exportStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const row = await loadReadable(req);
  const checksumMatches = await checksumMatchesFile(row.filePath, row.sha256);
  const legalHold = row.entityType != null && row.entityId != null ? await isOnLegalHold(req.db!, row.entityType, row.entityId) : false;
  res.json({
    exportId: row.exportId,
    recordNumber: row.recordNumber,
    revision: row.revision,
    status: row.recordStatus,
    exportedAt: row.generatedAt.toISOString(),
    checksumMatches,
    generatedBy: await generatedByName(req.db!, row.generatedBy),
    sha256: row.sha256,
    size: row.fileSize,
    mime: row.mimeType,
    renderer: row.renderer,
    sourceModule: row.sourceModule,
    entityType: row.entityType,
    entityId: row.entityId,
    legalHold,
    documentId: row.documentId,
    folderId: row.folderId,
    attachmentId: row.attachmentId,
    canAttach: row.entityId != null && attachmentTarget(row.entityType) != null,
  });
});

export const downloadStoredExportHandler = asyncHandler(async (req: Request, res: Response) => {
  const row = await loadReadable(req);
  if (!existsSync(row.filePath)) throw AppError.notFound("Export file");
  const name = `${row.recordNumber || row.exportId}.pdf`;
  await sendStoredFile(res, row.filePath, name, row.mimeType, "preview");
});

export const fileExportHandler = asyncHandler(async (req: Request, res: Response) => {
  const row = await loadReadable(req);
  const body = req.body as { folderId?: number; name?: string };
  const folderId = Number(body.folderId);
  const filed = await fileExportIntoFolder(req, row, folderId, body.name);
  res.status(201).json(filed);
});

export const attachExportHandler = asyncHandler(async (req: Request, res: Response) => {
  const row = await loadReadable(req);
  const created = await attachExportToRecord(req, row);
  res.status(201).json({ id: created.id, fileName: created.fileName, sha256: row.sha256 });
});

async function requireLegalHoldEdit(req: Request) {
  if (!req.user || !req.db) throw AppError.forbidden("You can't change a legal hold.");
  const level = await getUserAccessLevel(req.db, req.user, "legal_hold");
  if (level !== "edit") throw AppError.forbidden("You can't change a legal hold.");
}

export const placeLegalHoldHandler = asyncHandler(async (req: Request, res: Response) => {
  await requireLegalHoldEdit(req);
  const body = req.body as { entityType?: string; entityId?: number; reason?: string };
  const entityType = String(body.entityType ?? "").trim();
  const entityId = Number(body.entityId);
  if (!entityType || !Number.isInteger(entityId) || entityId < 1) throw AppError.badRequest("Choose a record.");
  const row = await placeLegalHold(req.db!, entityType, entityId, req.user!.id, body.reason);
  res.status(201).json({ id: row.id, entityType: row.entityType, entityId: row.entityId, placedAt: row.placedAt });
});

export const releaseLegalHoldHandler = asyncHandler(async (req: Request, res: Response) => {
  await requireLegalHoldEdit(req);
  const body = req.body as { entityType?: string; entityId?: number; reason?: string };
  const entityType = String(body.entityType ?? "").trim();
  const entityId = Number(body.entityId);
  if (!entityType || !Number.isInteger(entityId) || entityId < 1) throw AppError.badRequest("Choose a record.");
  const row = await releaseLegalHold(req.db!, entityType, entityId, req.user!.id, body.reason);
  res.json({ id: row.id, entityType: row.entityType, entityId: row.entityId, releasedAt: row.releasedAt });
});
