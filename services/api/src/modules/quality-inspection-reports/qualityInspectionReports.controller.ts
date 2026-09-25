import type { Request, Response } from "express";
import { and, eq, asc, desc } from "drizzle-orm";
import { qualityInspectionReports, qualityInspectionItems } from "../../drizzle/schema/qualityInspectionReports.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";

async function loadReport(req: Request, id: number) {
  const [row] = await req.db!.select().from(qualityInspectionReports).where(and(eq(qualityInspectionReports.id, id)));
  if (!row) throw AppError.notFound("Quality Inspection Report");
  return row;
}

export const listReportsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { finalStatus, supplierId } = req.query as Record<string, string | undefined>;
  const conditions = [];
  if (finalStatus) conditions.push(eq(qualityInspectionReports.finalStatus, finalStatus));
  if (supplierId) conditions.push(eq(qualityInspectionReports.supplierId, Number(supplierId)));
  const rows = await req.db!.select().from(qualityInspectionReports).where(and(...conditions)).orderBy(desc(qualityInspectionReports.createdAt));
  res.json(rows);
});

export const createReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const [created] = await req.db!.insert(qualityInspectionReports).values({ ...req.body, createdBy: req.user?.id }).returning();
  await recordAuditTrail(req.db!, { entityType: "QualityInspectionReport", entityId: created!.id, action: "create", changes: req.body, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const getReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadReport(req, Number(req.params.id));
  const items = await req.db!.select().from(qualityInspectionItems).where(and(eq(qualityInspectionItems.reportId, record.id))).orderBy(asc(qualityInspectionItems.itemNumber), asc(qualityInspectionItems.id));
  res.json({ ...record, items });
});

export const updateReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadReport(req, Number(req.params.id));

  // Sprint 2 fix (accuqual-implementation-sequencing.md) — finalStatus isn't
  // a linear chain (reporting.service.ts treats null as "pending", then one
  // of 4 terminal values chosen once — see that file's byFinalStatus/
  // inspectionBacklog logic), so this guards it as "set once from null,
  // then immutable" rather than inventing an ALLOWED_NEXT order that
  // doesn't exist in this codebase. Left on the same generic PATCH the real
  // frontend already calls (QualityInspectionReportDetailPage.tsx's radio
  // group) instead of a new, unused dedicated endpoint.
  if (Object.prototype.hasOwnProperty.call(req.body, "finalStatus") && record.finalStatus !== null && req.body.finalStatus !== record.finalStatus) {
    throw AppError.badRequest(`This report's disposition is already "${record.finalStatus}" and cannot be changed once set.`);
  }

  const [updated] = await req.db!.update(qualityInspectionReports).set({ ...req.body, updatedAt: new Date() }).where(eq(qualityInspectionReports.id, record.id)).returning();
  await recordAuditTrail(req.db!, { entityType: "QualityInspectionReport", entityId: record.id, action: "update", changes: req.body, performedBy: req.user?.id });
  res.json(updated);
});

export const deleteReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadReport(req, Number(req.params.id));
  await req.db!.delete(qualityInspectionItems).where(and(eq(qualityInspectionItems.reportId, record.id)));
  await req.db!.delete(qualityInspectionReports).where(and(eq(qualityInspectionReports.id, record.id)));
  await recordAuditTrail(req.db!, { entityType: "QualityInspectionReport", entityId: record.id, action: "delete", changes: {}, performedBy: req.user?.id });
  res.status(204).send();
});

// ---- Inspection Checklist items (the mockup's repeatable table) ----

async function loadItem(req: Request, reportId: number, itemId: number) {
  const [row] = await req.db!.select().from(qualityInspectionItems).where(and(eq(qualityInspectionItems.id, itemId), eq(qualityInspectionItems.reportId, reportId)));
  if (!row) throw AppError.notFound("Inspection item");
  return row;
}

export const createItemHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadReport(req, Number(req.params.id));
  const [created] = await req.db!.insert(qualityInspectionItems).values({ ...req.body, reportId: record.id, }).returning();
  await recordAuditTrail(req.db!, { entityType: "QualityInspectionReport", entityId: record.id, action: "update", changes: { subAction: "item_added", ...req.body }, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const updateItemHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadReport(req, Number(req.params.id));
  const item = await loadItem(req, record.id, Number(req.params.itemId));
  const [updated] = await req.db!.update(qualityInspectionItems).set({ ...req.body, updatedAt: new Date() }).where(eq(qualityInspectionItems.id, item.id)).returning();
  await recordAuditTrail(req.db!, { entityType: "QualityInspectionReport", entityId: record.id, action: "update", changes: { subAction: "item_updated", itemId: item.id, ...req.body }, performedBy: req.user?.id });
  res.json(updated);
});

export const deleteItemHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadReport(req, Number(req.params.id));
  const item = await loadItem(req, record.id, Number(req.params.itemId));
  await req.db!.delete(qualityInspectionItems).where(eq(qualityInspectionItems.id, item.id));
  await recordAuditTrail(req.db!, { entityType: "QualityInspectionReport", entityId: record.id, action: "update", changes: { subAction: "item_removed", itemId: item.id }, performedBy: req.user?.id });
  res.status(204).send();
});
