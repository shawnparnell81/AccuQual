import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { roles } from "../../drizzle/schema/roles.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";

/**
 * Roles are platform-wide constants (admin, quality_manager, ...), not
 * tenant data — so unlike every other module this one intentionally uses
 * the plain, unscoped `db` singleton rather than `req.db`/`req.tenantId`.
 */
export const listRoles = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await db.select().from(roles));
});

export const getRole = asyncHandler(async (req: Request, res: Response) => {
  const [role] = await db.select().from(roles).where(eq(roles.id, Number(req.params.id)));
  if (!role) throw AppError.notFound("Role");
  res.json(role);
});

export const createRole = asyncHandler(async (req: Request, res: Response) => {
  const [created] = await db.insert(roles).values(req.body).returning();
  res.status(201).json(created);
});

export const updateRole = asyncHandler(async (req: Request, res: Response) => {
  const [updated] = await db.update(roles).set(req.body).where(eq(roles.id, Number(req.params.id))).returning();
  if (!updated) throw AppError.notFound("Role");
  res.json(updated);
});
