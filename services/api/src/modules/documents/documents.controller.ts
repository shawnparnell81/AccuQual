import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { documents, documentVersions } from "../../drizzle/schema/documents.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";

export const baseHandlers = crudFactory(documents, { entityName: "Document", idColumn: "id", softDelete: true });

export const addVersionHandler = asyncHandler(async (req: Request, res: Response) => {
  const documentId = Number(req.params.id);
  const [doc] = await req.db!.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.tenantId, req.tenantId!)));
  if (!doc) throw AppError.notFound("Document");

  const nextVersion = doc.currentVersion + 1;
  const [version] = await req
    .db!.insert(documentVersions)
    .values({
      tenantId: req.tenantId!,
      documentId,
      version: nextVersion,
      fileUrl: req.body.fileUrl,
      changeNotes: req.body.changeNotes,
      createdBy: req.user?.id,
    })
    .returning();

  await req
    .db!.update(documents)
    .set({ currentVersion: nextVersion, status: "in_review", updatedAt: new Date() })
    .where(eq(documents.id, documentId));

  res.status(201).json(version);
});

export const approveHandler = asyncHandler(async (req: Request, res: Response) => {
  const documentId = Number(req.params.id);
  const [doc] = await req.db!.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.tenantId, req.tenantId!)));
  if (!doc) throw AppError.notFound("Document");

  await req
    .db!.update(documentVersions)
    .set({ approvedBy: req.user?.id, approvedAt: new Date() })
    .where(and(eq(documentVersions.documentId, documentId), eq(documentVersions.tenantId, req.tenantId!)));

  const [updated] = await req
    .db!.update(documents)
    .set({ status: "approved", updatedAt: new Date() })
    .where(eq(documents.id, documentId))
    .returning();
  res.json(updated);
});

export const historyHandler = asyncHandler(async (req: Request, res: Response) => {
  const versions = await req
    .db!.select()
    .from(documentVersions)
    .where(and(eq(documentVersions.documentId, Number(req.params.id)), eq(documentVersions.tenantId, req.tenantId!)));
  res.json(versions);
});
