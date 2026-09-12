import type { Request, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
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

/** Full flat folder list for the tenant, seeding the default department tree on first use. */
export const list = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db!;
  const tenantId = req.tenantId!;

  const existing = await db.select().from(documentFolders).where(eq(documentFolders.tenantId, tenantId));
  if (existing.length === 0) {
    await seedDefaults(db, tenantId);
    const seeded = await db.select().from(documentFolders).where(eq(documentFolders.tenantId, tenantId));
    return res.json(seeded);
  }
  res.json(existing);
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
