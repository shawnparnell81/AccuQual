import type { Request, Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { documentComments } from "../../drizzle/schema/documents.js";
import { documents } from "../../drizzle/schema/documents.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import { controlledVersions } from "../../drizzle/schema/versioning.js";
import { users } from "../../drizzle/schema/users.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import type { Db } from "../../lib/requestDb.js";

const MAX_BODY = 2000;

export interface DocumentCommentRow {
  id: number;
  documentId: number | null;
  folderId: number | null;
  versionId: number | null;
  versionNumber: number | null;
  body: string;
  authorId: number | null;
  authorName: string;
  createdAt: string | null;
}

function authorLabel(name: string | null, email: string | null): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  if (email) return email;
  return "Someone";
}

async function listComments(db: Db, where: ReturnType<typeof eq>): Promise<DocumentCommentRow[]> {
  const rows = await db
    .select({
      id: documentComments.id,
      documentId: documentComments.documentId,
      folderId: documentComments.folderId,
      versionId: documentComments.versionId,
      versionNumber: controlledVersions.versionNumber,
      body: documentComments.body,
      authorId: documentComments.authorId,
      authorName: users.name,
      authorEmail: users.email,
      createdAt: documentComments.createdAt,
    })
    .from(documentComments)
    .leftJoin(users, eq(users.id, documentComments.authorId))
    .leftJoin(controlledVersions, eq(controlledVersions.id, documentComments.versionId))
    .where(where)
    .orderBy(desc(documentComments.id))
    .limit(100);
  return rows.map((row) => ({
    id: row.id,
    documentId: row.documentId,
    folderId: row.folderId,
    versionId: row.versionId,
    versionNumber: row.versionNumber,
    body: row.body,
    authorId: row.authorId,
    authorName: authorLabel(row.authorName, row.authorEmail),
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
  }));
}

function readBody(req: Request): { body: string; versionId: number | null } {
  const text = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!text) throw AppError.badRequest("Write a comment before saving it.");
  if (text.length > MAX_BODY) throw AppError.badRequest(`Comments stay under ${MAX_BODY} characters.`);
  const rawVersion = req.body?.versionId;
  if (rawVersion == null || rawVersion === "") return { body: text, versionId: null };
  const versionId = Number(rawVersion);
  if (!Number.isInteger(versionId) || versionId < 1) throw AppError.badRequest("That revision isn't valid.");
  return { body: text, versionId };
}

export const listDocumentCommentsHandler = asyncHandler(async (req: Request, res: Response) => {
  const documentId = Number(req.params.id);
  if (!Number.isInteger(documentId) || documentId < 1) throw AppError.badRequest("Invalid document id");
  const db = req.db! as Db;
  const [doc] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.id, documentId), eq(documents.isDeleted, false)));
  if (!doc) throw AppError.notFound("Document");
  res.json({ comments: await listComments(db, eq(documentComments.documentId, documentId)) });
});

export const createDocumentCommentHandler = asyncHandler(async (req: Request, res: Response) => {
  const documentId = Number(req.params.id);
  if (!Number.isInteger(documentId) || documentId < 1) throw AppError.badRequest("Invalid document id");
  const { body, versionId } = readBody(req);
  const db = req.db! as Db;
  const [doc] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.id, documentId), eq(documents.isDeleted, false)));
  if (!doc) throw AppError.notFound("Document");
  if (versionId != null) {
    const [version] = await db
      .select({ id: controlledVersions.id })
      .from(controlledVersions)
      .where(and(eq(controlledVersions.id, versionId), eq(controlledVersions.subjectType, "document"), eq(controlledVersions.subjectId, documentId)));
    if (!version) throw AppError.badRequest("That revision is not on this document.");
  }
  const [created] = await db
    .insert(documentComments)
    .values({ documentId, versionId, body, authorId: req.user!.id })
    .returning({ id: documentComments.id });
  const comments = await listComments(db, eq(documentComments.id, created!.id));
  res.status(201).json({ comment: comments[0] });
});

export const listFolderCommentsHandler = asyncHandler(async (req: Request, res: Response) => {
  const folderId = Number(req.params.id);
  if (!Number.isInteger(folderId) || folderId < 1) throw AppError.badRequest("Invalid folder id");
  const db = req.db! as Db;
  const [folder] = await db.select({ id: documentFolders.id }).from(documentFolders).where(eq(documentFolders.id, folderId));
  if (!folder) throw AppError.notFound("Folder");
  res.json({ comments: await listComments(db, eq(documentComments.folderId, folderId)) });
});

export const createFolderCommentHandler = asyncHandler(async (req: Request, res: Response) => {
  const folderId = Number(req.params.id);
  if (!Number.isInteger(folderId) || folderId < 1) throw AppError.badRequest("Invalid folder id");
  const { body } = readBody(req);
  const db = req.db! as Db;
  const [folder] = await db.select({ id: documentFolders.id, documentId: documentFolders.documentId }).from(documentFolders).where(eq(documentFolders.id, folderId));
  if (!folder) throw AppError.notFound("Folder");
  const [created] = await db
    .insert(documentComments)
    .values({ folderId, documentId: folder.documentId, body, authorId: req.user!.id })
    .returning({ id: documentComments.id });
  const comments = await listComments(db, eq(documentComments.id, created!.id));
  res.status(201).json({ comment: comments[0] });
});
