import type { Request, Response } from "express";
import { and, eq, asc, desc } from "drizzle-orm";
import { qmsForms, qmsFormRows } from "../../drizzle/schema/qmsForms.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { getQmsFormDefinition, QMS_FORM_DEFINITIONS } from "./qmsFormDefinitions.js";

async function loadForm(req: Request, id: number) {
  const [row] = await req.db!.select().from(qmsForms).where(and(eq(qmsForms.id, id), eq(qmsForms.tenantId, req.tenantId!)));
  if (!row) throw AppError.notFound("QMS form");
  return row;
}

export const listQmsFormTypesHandler = asyncHandler(async (_req: Request, res: Response) => {
  res.json(QMS_FORM_DEFINITIONS);
});

export const listQmsFormsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { formType, status } = req.query as Record<string, string | undefined>;
  const conditions = [eq(qmsForms.tenantId, req.tenantId!)];
  if (formType) conditions.push(eq(qmsForms.formType, formType));
  if (status) conditions.push(eq(qmsForms.status, status));
  const rows = await req.db!.select().from(qmsForms).where(and(...conditions)).orderBy(desc(qmsForms.createdAt));
  res.json(rows);
});

export const createQmsFormHandler = asyncHandler(async (req: Request, res: Response) => {
  const { formType } = req.body as { formType: string };
  const definition = getQmsFormDefinition(formType);
  if (!definition) throw AppError.badRequest(`Unknown form type "${formType}"`);
  const [created] = await req.db!.insert(qmsForms).values({ ...req.body, tenantId: req.tenantId!, createdBy: req.user?.id }).returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "QmsForm", entityId: created!.id, action: "create", changes: req.body, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const getQmsFormHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadForm(req, Number(req.params.id));
  const rows = await req.db!.select().from(qmsFormRows).where(and(eq(qmsFormRows.formId, record.id), eq(qmsFormRows.tenantId, req.tenantId!))).orderBy(asc(qmsFormRows.sectionKey), asc(qmsFormRows.sortOrder), asc(qmsFormRows.id));
  const definition = getQmsFormDefinition(record.formType);
  res.json({ ...record, definition, rows });
});

export const updateQmsFormHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadForm(req, Number(req.params.id));
  const [updated] = await req.db!.update(qmsForms).set({ ...req.body, updatedAt: new Date() }).where(eq(qmsForms.id, record.id)).returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "QmsForm", entityId: record.id, action: "update", changes: req.body, performedBy: req.user?.id });
  res.json(updated);
});

export const deleteQmsFormHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadForm(req, Number(req.params.id));
  await req.db!.delete(qmsFormRows).where(and(eq(qmsFormRows.formId, record.id), eq(qmsFormRows.tenantId, req.tenantId!)));
  await req.db!.delete(qmsForms).where(and(eq(qmsForms.id, record.id), eq(qmsForms.tenantId, req.tenantId!)));
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "QmsForm", entityId: record.id, action: "delete", changes: { formType: record.formType, formNo: record.formNo }, performedBy: req.user?.id });
  res.status(204).send();
});

// ---- Generic rows (one of the formType's own named table sections — see qmsFormDefinitions.ts) ----

async function loadRow(req: Request, formId: number, rowId: number) {
  const [row] = await req.db!.select().from(qmsFormRows).where(and(eq(qmsFormRows.id, rowId), eq(qmsFormRows.formId, formId), eq(qmsFormRows.tenantId, req.tenantId!)));
  if (!row) throw AppError.notFound("Row");
  return row;
}

export const createQmsFormRowHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadForm(req, Number(req.params.id));
  const definition = getQmsFormDefinition(record.formType);
  const { sectionKey, data } = req.body as { sectionKey: string; data?: Record<string, string> };
  if (!definition?.sections.some((s) => s.key === sectionKey)) throw AppError.badRequest(`"${sectionKey}" is not a real section of "${record.formType}"`);
  const [created] = await req.db!.insert(qmsFormRows).values({ tenantId: req.tenantId!, formId: record.id, sectionKey, data: data ?? {} }).returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "QmsForm", entityId: record.id, action: "update", changes: { subAction: "row_added", sectionKey }, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const updateQmsFormRowHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadForm(req, Number(req.params.id));
  const row = await loadRow(req, record.id, Number(req.params.rowId));
  const { data } = req.body as { data: Record<string, string> };
  const [updated] = await req.db!.update(qmsFormRows).set({ data, updatedAt: new Date() }).where(eq(qmsFormRows.id, row.id)).returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "QmsForm", entityId: record.id, action: "update", changes: { subAction: "row_updated", rowId: row.id }, performedBy: req.user?.id });
  res.json(updated);
});

export const deleteQmsFormRowHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadForm(req, Number(req.params.id));
  const row = await loadRow(req, record.id, Number(req.params.rowId));
  await req.db!.delete(qmsFormRows).where(eq(qmsFormRows.id, row.id));
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "QmsForm", entityId: record.id, action: "update", changes: { subAction: "row_removed", rowId: row.id }, performedBy: req.user?.id });
  res.status(204).send();
});
