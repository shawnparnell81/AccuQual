import type { Request, Response } from "express";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { and, eq, isNull } from "drizzle-orm";
import { documentFolders, LIBRARY_POOL_NAME } from "../../drizzle/schema/documentFolders.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import type { TenantDb } from "../../lib/tenantScope.js";
import { DEFAULT_DOCUMENT_FOLDERS, type DefaultFolderSeed } from "./defaultDocumentFolders.js";

/**
 * Inserts one level of the default tree at a time (each level needs the
 * previous level's real auto-increment ids as `parentId`, so this can't be a
 * single bulk insert). Only ever runs once per tenant — see `list` below.
 */
async function seedDefaults(db: TenantDb, tenantId: number): Promise<void> {
  async function insertLevel(nodes: DefaultFolderSeed[], parentId: number | null): Promise<void> {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      const [created] = await db
        .insert(documentFolders)
        .values({ tenantId, name: node.name, parentId: parentId ?? undefined, sortOrder: i })
        .returning();
      if (!created) throw new Error("Insert did not return the created document folder");
      if (node.children.length > 0) await insertLevel(node.children, created.id);
    }
  }
  await insertLevel(DEFAULT_DOCUMENT_FOLDERS, null);
}

/**
 * Ensures the tenant has a top-level "Library Pool" node — the one place
 * "remove this form" moves a leaf to (see the schema comment). Runs on every
 * `list` call rather than only during initial seeding, so it self-heals for
 * tenants that already existed before this feature shipped, and even
 * recreates it if a user ever deletes it.
 */
async function ensureLibraryPool(db: TenantDb, tenantId: number, topLevel: (typeof documentFolders.$inferSelect)[]): Promise<typeof documentFolders.$inferSelect> {
  const existingPool = topLevel.find((f) => f.name === LIBRARY_POOL_NAME);
  if (existingPool) return existingPool;
  const siblingCount = topLevel.length;
  const [created] = await db.insert(documentFolders).values({ tenantId, name: LIBRARY_POOL_NAME, sortOrder: siblingCount }).returning();
  if (!created) throw new AppError("Failed to create the library pool folder", 500);
  return created;
}

/** Full flat folder list for the tenant, seeding the default department tree on first use. */
export const list = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db!;
  const tenantId = req.tenantId!;

  const existing = await db.select().from(documentFolders).where(eq(documentFolders.tenantId, tenantId));
  if (existing.length === 0) {
    await seedDefaults(db, tenantId);
    const seeded = await db.select().from(documentFolders).where(eq(documentFolders.tenantId, tenantId));
    const pool = await ensureLibraryPool(db, tenantId, seeded.filter((f) => f.parentId === null));
    return res.json([...seeded, pool]);
  }

  const pool = await ensureLibraryPool(db, tenantId, existing.filter((f) => f.parentId === null));
  const alreadyIncluded = existing.some((f) => f.id === pool.id);
  res.json(alreadyIncluded ? existing : [...existing, pool]);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db!;
  const tenantId = req.tenantId!;
  const { name, parentId } = req.body as { name: string; parentId?: number };

  if (parentId !== undefined) {
    const [parent] = await db.select().from(documentFolders).where(and(eq(documentFolders.id, parentId), eq(documentFolders.tenantId, tenantId)));
    if (!parent) throw AppError.notFound("Parent folder");
  }

  const siblings = await db
    .select()
    .from(documentFolders)
    .where(and(eq(documentFolders.tenantId, tenantId), parentId === undefined ? isNull(documentFolders.parentId) : eq(documentFolders.parentId, parentId)));

  const [created] = await db
    .insert(documentFolders)
    .values({ tenantId, name, parentId, sortOrder: siblings.length })
    .returning();
  res.status(201).json(created);
});

/** Would setting `candidateParentId` as this folder's parent make it its own ancestor? */
async function wouldCreateCycle(db: TenantDb, tenantId: number, folderId: number, candidateParentId: number): Promise<boolean> {
  let cursor: number | null = candidateParentId;
  const seen = new Set<number>();
  while (cursor !== null) {
    if (cursor === folderId) return true;
    if (seen.has(cursor)) return false; // defensive: shouldn't happen in a well-formed tree
    seen.add(cursor);
    const [row] = await db.select().from(documentFolders).where(and(eq(documentFolders.id, cursor), eq(documentFolders.tenantId, tenantId)));
    cursor = row?.parentId ?? null;
  }
  return false;
}

export const update = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db!;
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);
  const { name, parentId, sortOrder } = req.body as { name?: string; parentId?: number | null; sortOrder?: number };

  const [current] = await db.select().from(documentFolders).where(and(eq(documentFolders.id, id), eq(documentFolders.tenantId, tenantId)));
  if (!current) throw AppError.notFound("Document folder");

  if (parentId !== undefined && parentId !== null) {
    if (parentId === id) throw AppError.badRequest("A folder cannot be its own parent");
    const [parent] = await db.select().from(documentFolders).where(and(eq(documentFolders.id, parentId), eq(documentFolders.tenantId, tenantId)));
    if (!parent) throw AppError.notFound("Parent folder");
    if (await wouldCreateCycle(db, tenantId, id, parentId)) {
      throw AppError.badRequest("That move would nest a folder inside itself");
    }
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) patch.name = name;
  if (parentId !== undefined) patch.parentId = parentId;
  if (sortOrder !== undefined) patch.sortOrder = sortOrder;

  const [updated] = await db
    .update(documentFolders)
    .set(patch)
    .where(and(eq(documentFolders.id, id), eq(documentFolders.tenantId, tenantId)))
    .returning();
  if (!updated) throw AppError.notFound("Document folder");
  res.json(updated);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db!;
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);

  const children = await db.select().from(documentFolders).where(and(eq(documentFolders.parentId, id), eq(documentFolders.tenantId, tenantId)));
  if (children.length > 0) {
    throw AppError.badRequest("Move or delete this folder's contents before deleting it");
  }

  const [deleted] = await db
    .delete(documentFolders)
    .where(and(eq(documentFolders.id, id), eq(documentFolders.tenantId, tenantId)))
    .returning();
  if (!deleted) throw AppError.notFound("Document folder");
  res.status(204).send();
});

/**
 * Attach a user-uploaded PDF to a folder node ("use your own form instead of
 * — or in addition to — the supplied taxonomy"). Multer (memoryStorage, see
 * routes) has already validated size/mimetype and put the file on
 * `req.file`; this just persists it under the tenant's provisioned
 * `forms/custom` directory (same STORAGE_LOCAL_PATH convention the seeded
 * form templates use) and records the path on the folder row. Replacing an
 * existing attachment deletes the old file first.
 */
export const uploadTemplate = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db!;
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);
  const file = req.file;
  if (!file) throw AppError.badRequest("No file uploaded");
  if (file.mimetype !== "application/pdf") throw AppError.badRequest("Only PDF files are accepted");

  const [folder] = await db.select().from(documentFolders).where(and(eq(documentFolders.id, id), eq(documentFolders.tenantId, tenantId)));
  if (!folder) throw AppError.notFound("Document folder");

  const dir = `${env.STORAGE_LOCAL_PATH}/tenants/${tenantId}/forms/custom`;
  await mkdir(dir, { recursive: true });
  const path = `${dir}/${id}-${Date.now()}.pdf`;
  await writeFile(path, file.buffer);

  if (folder.pdfPath && existsSync(folder.pdfPath)) {
    await unlink(folder.pdfPath).catch((err) => logger.warn(`Could not remove replaced template file ${folder.pdfPath}`, err));
  }

  const [updated] = await db
    .update(documentFolders)
    .set({ pdfPath: path, updatedAt: new Date() })
    .where(and(eq(documentFolders.id, id), eq(documentFolders.tenantId, tenantId)))
    .returning();
  res.status(201).json(updated);
});

/** Streams the attached PDF back, e.g. for the "live preview" / download affordance. */
export const downloadTemplate = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db!;
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);

  const [folder] = await db.select().from(documentFolders).where(and(eq(documentFolders.id, id), eq(documentFolders.tenantId, tenantId)));
  if (!folder) throw AppError.notFound("Document folder");
  if (!folder.pdfPath || !existsSync(folder.pdfPath)) throw AppError.notFound("Attached template file");

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${folder.name.replace(/[^\w.-]+/g, "_")}.pdf"`);
  createReadStream(folder.pdfPath).pipe(res);
});

/**
 * Detaches the PDF from a folder node — the node itself (and its place in the
 * tree) is untouched; only the attached file goes away. To send the whole
 * node back to the library pool instead, use PATCH .../:id { parentId }.
 */
export const removeTemplate = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db!;
  const tenantId = req.tenantId!;
  const id = Number(req.params.id);

  const [folder] = await db.select().from(documentFolders).where(and(eq(documentFolders.id, id), eq(documentFolders.tenantId, tenantId)));
  if (!folder) throw AppError.notFound("Document folder");

  if (folder.pdfPath && existsSync(folder.pdfPath)) {
    await unlink(folder.pdfPath).catch((err) => logger.warn(`Could not remove template file ${folder.pdfPath}`, err));
  }

  const [updated] = await db
    .update(documentFolders)
    .set({ pdfPath: null, updatedAt: new Date() })
    .where(and(eq(documentFolders.id, id), eq(documentFolders.tenantId, tenantId)))
    .returning();
  res.json(updated);
});
