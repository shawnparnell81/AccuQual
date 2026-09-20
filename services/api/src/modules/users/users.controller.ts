import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { users } from "../../drizzle/schema/users.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";

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

  // Previously the only mutating handler in the codebase with zero audit
  // trail — this is also the real endpoint behind both User Onboarding and
  // a Role Change's roleId path, so this one change closes both gaps at
  // once (see accuqual-workflow-architecture.md's audit-gap finding).
  await recordAuditTrail(req.db!, {
    tenantId: req.tenantId!,
    entityType: "User",
    entityId: updated.id,
    action: "update",
    changes: { fieldsChanged: Object.keys(req.body) },
    performedBy: req.user?.id,
  });

  const { passwordHash: _omit, ...safe } = updated;
  res.json(safe);
});

/**
 * A user's own theme override — scoped by req.user!.id alone (no admin
 * check, unlike GET/PATCH /users/:id, since this only ever reads/writes the
 * caller's own row). This router's withTenantDb already requires a
 * tenantId to reach here at all, so platform_admin accounts (no tenantId)
 * hit the same "Missing tenant context" 401 every other /users/* route
 * already gives them — not something new this endpoint introduces.
 */
export const getMyTheme = asyncHandler(async (req: Request, res: Response) => {
  const [row] = await req.db!.select({ themePreferences: users.themePreferences }).from(users).where(eq(users.id, req.user!.id));
  res.json(row?.themePreferences ?? {});
});

export const updateMyTheme = asyncHandler(async (req: Request, res: Response) => {
  const [existing] = await req.db!.select({ themePreferences: users.themePreferences }).from(users).where(eq(users.id, req.user!.id));
  const body = req.body as Record<string, string>;
  // "" clears a field back to unset (follow tenant/default) rather than storing an empty string forever.
  const patch = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v === "" ? undefined : v]));
  const merged = { ...existing?.themePreferences, ...patch };
  const fieldsChanged = Object.keys(body);

  const [updated] = await req.db!.update(users).set({ themePreferences: merged, updatedAt: new Date() }).where(eq(users.id, req.user!.id)).returning();
  if (!updated) throw AppError.notFound("User");

  await recordAuditTrail(req.db!, {
    tenantId: req.tenantId!,
    entityType: "User",
    entityId: req.user!.id,
    action: "update",
    changes: { fieldsChanged },
    performedBy: req.user?.id,
  });
  res.json(updated.themePreferences);
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  const [updated] = await req
    .db!.update(users)
    .set({ isActive: false })
    .where(and(eq(users.id, Number(req.params.id)), eq(users.tenantId, req.tenantId!)))
    .returning();
  if (!updated) throw AppError.notFound("User");
  // Deactivation is an access-removal event an auditor asks about — it used to leave no entry at all.
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "User", entityId: updated.id, action: "status_change", changes: { action: "deactivate" }, performedBy: req.user?.id });
  res.status(204).send();
});
