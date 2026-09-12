import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { users } from "../../drizzle/schema/users.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const rows = await req
    .db!.select({
      id: users.id,
      email: users.email,
      name: users.name,
      roleId: users.roleId,
      department: users.department,
      isActive: users.isActive,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.tenantId, req.tenantId!));
  res.json(rows);
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const [row] = await req
    .db!.select({
      id: users.id,
      email: users.email,
      name: users.name,
      roleId: users.roleId,
      department: users.department,
      isActive: users.isActive,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(and(eq(users.id, Number(req.params.id)), eq(users.tenantId, req.tenantId!)));
  if (!row) throw AppError.notFound("User");
  res.json(row);
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const { email, password, name, roleId, department } = req.body;
  const passwordHash = await bcrypt.hash(password, 10);
  const [created] = await req.db!.insert(users).values({ email, passwordHash, name, roleId, department, tenantId: req.tenantId! }).returning();
  if (!created) throw new AppError("Failed to create user", 500);
  const { passwordHash: _omit, ...safe } = created;
  res.status(201).json(safe);
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const [updated] = await req
    .db!.update(users)
    .set({ ...req.body, updatedAt: new Date() })
    .where(and(eq(users.id, Number(req.params.id)), eq(users.tenantId, req.tenantId!)))
    .returning();
  if (!updated) throw AppError.notFound("User");
  const { passwordHash: _omit, ...safe } = updated;
  res.json(safe);
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  const [updated] = await req
    .db!.update(users)
    .set({ isActive: false })
    .where(and(eq(users.id, Number(req.params.id)), eq(users.tenantId, req.tenantId!)))
    .returning();
  if (!updated) throw AppError.notFound("User");
  res.status(204).send();
});
