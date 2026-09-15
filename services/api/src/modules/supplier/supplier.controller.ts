import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { suppliers, supplierScorecards } from "../../drizzle/schema/supplier.js";
import { users } from "../../drizzle/schema/users.js";
import { roles } from "../../drizzle/schema/roles.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";

export const baseHandlers = crudFactory(suppliers, { entityName: "Supplier", idColumn: "id" });

export const addScorecardHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = Number(req.params.id);
  const [supplier] = await req.db!.select().from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.tenantId, req.tenantId!)));
  if (!supplier) throw AppError.notFound("Supplier");

  const { qualityScore = 0, deliveryScore = 0 } = req.body;
  const overallScore = (Number(qualityScore) + Number(deliveryScore)) / 2;

  const [scorecard] = await req
    .db!.insert(supplierScorecards)
    .values({ ...req.body, supplierId, tenantId: req.tenantId!, overallScore: String(overallScore) })
    .returning();
  res.status(201).json(scorecard);
});

/**
 * Real dedicated status-change actions for a module that previously had none
 * (see the Transitions/Rules/Outputs Dictionaries: every supplier status
 * change went through the generic PATCH, with no curated audit entry and no
 * Workflow Engine trigger). "disqualified" is treated as terminal — none of
 * the other three actions can move a supplier back out of it; only a plain
 * PATCH (or a future dedicated "reinstate" action) could, deliberately.
 */
async function setSupplierStatus(req: Request, res: Response, action: string, newStatus: string) {
  const id = Number(req.params.id);
  const tenantId = req.tenantId!;
  const [current] = await req.db!.select().from(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.tenantId, tenantId)));
  if (!current) throw AppError.notFound("Supplier");
  if (current.status === "disqualified") throw AppError.badRequest(`Cannot "${action}" a disqualified supplier — disqualification is terminal`);

  const [updated] = await req.db!.update(suppliers).set({ status: newStatus }).where(eq(suppliers.id, id)).returning();

  await recordAuditTrail(req.db!, { tenantId, entityType: "Supplier", entityId: id, action: "status_change", changes: { action, from: current.status, to: newStatus }, performedBy: req.user?.id });
  await publishEvent(WORKFLOW_STREAM, { tenantId, module: "supplier", event: action, entityId: id });

  res.json(updated);
}

export const approveHandler = asyncHandler((req: Request, res: Response) => setSupplierStatus(req, res, "approve", "active"));
export const conditionalHandler = asyncHandler((req: Request, res: Response) => setSupplierStatus(req, res, "conditional", "probation"));
// "suspended" is a new value, not yet in the schema comment's enum list —
// safe to introduce because `status` is a plain text column, not a DB enum.
export const suspendHandler = asyncHandler((req: Request, res: Response) => setSupplierStatus(req, res, "suspend", "suspended"));
export const removeHandler = asyncHandler(async (req: Request, res: Response) => {
  // Disqualification is the one status change allowed to run even from
  // "disqualified" itself (idempotent) — it's the terminal state, not
  // something to be blocked from re-affirming.
  const id = Number(req.params.id);
  const tenantId = req.tenantId!;
  const [current] = await req.db!.select().from(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.tenantId, tenantId)));
  if (!current) throw AppError.notFound("Supplier");

  const [updated] = await req.db!.update(suppliers).set({ status: "disqualified" }).where(eq(suppliers.id, id)).returning();
  await recordAuditTrail(req.db!, { tenantId, entityType: "Supplier", entityId: id, action: "status_change", changes: { action: "remove", from: current.status, to: "disqualified" }, performedBy: req.user?.id });
  await publishEvent(WORKFLOW_STREAM, { tenantId, module: "supplier", event: "remove", entityId: id });
  res.json(updated);
});

/**
 * Creates the Supplier Portal's "external supplier login" — a real `users`
 * row using the "supplier" role this app's own seed data already reserves
 * for exactly this (see db/seed.ts), linked to this one supplier via
 * users.supplierId (department stays null — an external account is never
 * part of any internal department's dropdown, same as users.ts's own
 * comment). Gated by this router's existing requireDepartmentAccess
 * ("suppliers") — quality/admin only, same access level "approve" etc.
 * above already require. No SMTP is configured in this environment, so the
 * generated temporary password is returned once in the response (same
 * "logged/returned, never silently claimed as emailed" honesty as
 * auth.service.ts's forgotPassword) — a real deployment would email it
 * instead of displaying it.
 */
export const createPortalAccountHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = Number(req.params.id);
  const tenantId = req.tenantId!;
  const [supplier] = await req.db!.select().from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.tenantId, tenantId)));
  if (!supplier) throw AppError.notFound("Supplier");

  const { email, name } = req.body as { email: string; name?: string };
  const [existing] = await req.db!.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) throw AppError.badRequest("Email already registered");

  const [supplierRole] = await req.db!.select().from(roles).where(eq(roles.name, "supplier"));
  if (!supplierRole) throw new AppError("The 'supplier' role is not seeded — cannot create a portal login", 500);

  const tempPassword = randomBytes(9).toString("base64url");
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  const [created] = await req
    .db!.insert(users)
    .values({ tenantId, email, passwordHash, name: name ?? supplier.name, roleId: supplierRole.id, department: null, supplierId })
    .returning();
  if (!created) throw new AppError("Failed to create the portal login", 500);

  await recordAuditTrail(req.db!, { tenantId, entityType: "Supplier", entityId: supplierId, action: "update", changes: { action: "create_portal_account", email }, performedBy: req.user?.id });

  const { passwordHash: _omit, ...safe } = created;
  res.status(201).json({ user: safe, temporaryPassword: tempPassword });
});
