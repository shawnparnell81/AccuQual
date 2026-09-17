import type { Request, Response } from "express";
import { and, eq, desc } from "drizzle-orm";
import { scarForms } from "../../drizzle/schema/scarForms.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";

async function loadScar(req: Request, id: number) {
  const [row] = await req.db!.select().from(scarForms).where(and(eq(scarForms.id, id), eq(scarForms.tenantId, req.tenantId!)));
  if (!row) throw AppError.notFound("SCAR");
  return row;
}

export const listScarFormsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { status, supplierId } = req.query as Record<string, string | undefined>;
  const conditions = [eq(scarForms.tenantId, req.tenantId!)];
  if (status) conditions.push(eq(scarForms.status, status));
  if (supplierId) conditions.push(eq(scarForms.supplierId, Number(supplierId)));
  const rows = await req.db!.select().from(scarForms).where(and(...conditions)).orderBy(desc(scarForms.createdAt));
  res.json(rows);
});

export const createScarFormHandler = asyncHandler(async (req: Request, res: Response) => {
  const [created] = await req.db!.insert(scarForms).values({ ...req.body, tenantId: req.tenantId!, createdBy: req.user?.id }).returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "ScarForm", entityId: created!.id, action: "create", changes: req.body, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const getScarFormHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await loadScar(req, Number(req.params.id)));
});

export const updateScarFormHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadScar(req, Number(req.params.id));
  const [updated] = await req.db!.update(scarForms).set({ ...req.body, updatedAt: new Date() }).where(eq(scarForms.id, record.id)).returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "ScarForm", entityId: record.id, action: "update", changes: req.body, performedBy: req.user?.id });
  res.json(updated);
});

export const deleteScarFormHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadScar(req, Number(req.params.id));
  await req.db!.delete(scarForms).where(and(eq(scarForms.id, record.id), eq(scarForms.tenantId, req.tenantId!)));
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "ScarForm", entityId: record.id, action: "delete", changes: { scarNumber: record.scarNumber }, performedBy: req.user?.id });
  res.status(204).send();
});
