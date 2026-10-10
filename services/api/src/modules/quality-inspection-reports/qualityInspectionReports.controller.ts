import type { Request, Response } from "express";
import { and, eq, asc, desc } from "drizzle-orm";
import { qualityInspectionReports, qualityInspectionItems } from "../../drizzle/schema/qualityInspectionReports.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { requireSignatureStamp } from "../signatures/signaturePin.service.js";
import { assignSignatureRequired, signatureBlocksFor } from "../signatures/signatureRequired.js";
import { deleteRecord } from "../records/recordDeletion.js";
import { applyMeasuredResult } from "../../utils/passFail.js";
import { INSPECTION_NUMBER } from "../records/recordNumberSpecs.js";
import { applyRecordNumber, changesWithNumberEdit } from "../records/userRecordNumber.js";
import { ncrsForPath, openInspectionNcr, requireNcrEdit } from "../ncr/inspectionNcr.js";

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
  const body = { ...(req.body as Record<string, unknown>) };
  await applyRecordNumber(req.db!, body, INSPECTION_NUMBER);
  const [created] = await req.db!.insert(qualityInspectionReports).values({ ...body, createdBy: req.user?.id }).returning();
  await recordAuditTrail(req.db!, { entityType: "QualityInspectionReport", entityId: created!.id, action: "create", changes: req.body, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const getReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadReport(req, Number(req.params.id));
  const items = await req.db!.select().from(qualityInspectionItems).where(and(eq(qualityInspectionItems.reportId, record.id))).orderBy(asc(qualityInspectionItems.itemNumber), asc(qualityInspectionItems.id));
  const linkedNcrs = await ncrsForPath(req.db!, `/quality-inspection-reports/${record.id}`);
  res.json({ ...record, items, linkedNcrs });
});

export const createReportNcrHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw AppError.badRequest("Record is required");
  await requireNcrEdit(req.db!, { id: req.user?.id ?? 0, roleName: req.user?.roleName ?? null, department: req.user?.department ?? null });
  const record = await loadReport(req, id);
  const path = `/quality-inspection-reports/${id}`;
  const existing = await ncrsForPath(req.db!, path);
  if (existing[0]) {
    res.status(200).json({ id: existing[0].id, recordNumber: existing[0].recordNumber, existing: true });
    return;
  }
  const items = await req.db!.select().from(qualityInspectionItems).where(eq(qualityInspectionItems.reportId, id)).orderBy(asc(qualityInspectionItems.itemNumber), asc(qualityInspectionItems.id));
  const rows = items
    .filter((item) => /^fail/i.test(item.result ?? ""))
    .map((item) => {
      const band = [item.specMin, item.specMax].filter((value) => value != null && value !== "").join(" to ");
      return {
        measurement: item.parameter?.trim() || `Item ${item.itemNumber ?? item.id}`,
        spec: item.specification?.trim() || band || "(blank)",
        actual: item.actualFinding?.trim() || (item.actualValue != null ? String(item.actualValue) : "(blank)"),
      };
    });
  if (rows.length === 0 && (record.finalStatus === "rejected" || record.finalStatus === "rework_required")) {
    rows.push({ measurement: "Final status", spec: "Accepted", actual: record.finalStatus === "rejected" ? "Rejected" : "Rework required" });
  }
  if (rows.length === 0) throw AppError.badRequest("There is no failed measurement to put on an NCR.");
  const created = await openInspectionNcr(
    req.db!,
    {
      formTitle: "Quality inspection report",
      part: record.partMaterialNo?.trim() || "",
      path,
      formType: record.inspectionType ?? "quality_inspection",
      sourceId: id,
      kind: "quality_inspection",
      supplierId: record.supplierId,
      fallbackSiteId: req.siteId,
      receivingLineItemId: record.receivingLineItemId,
      rows,
      sourceAudit: { entityType: "QualityInspectionReport", entityId: id },
    },
    req.user?.id,
  );
  res.status(201).json({ id: created.id, recordNumber: created.recordNumber, title: created.title, existing: false });
});

export const updateReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadReport(req, Number(req.params.id));

  // One disposition, then it stays. Reporting treats null as pending. The report page still PATCHes this field.
  if (Object.prototype.hasOwnProperty.call(req.body, "finalStatus") && record.finalStatus !== null && req.body.finalStatus !== record.finalStatus) {
    throw AppError.badRequest(`This report's disposition is already "${record.finalStatus}" and cannot be changed once set.`);
  }

  const body = { ...(req.body as Record<string, unknown>) };
  const numberChange = await applyRecordNumber(req.db!, body, INSPECTION_NUMBER, { id: record.id, current: record.recordNumber, row: record });
  await assignSignatureRequired(req.db!, {
    entityType: "QualityInspectionReport",
    entityId: record.id,
    performedBy: req.user?.id,
    previous: record,
    body,
    blocks: signatureBlocksFor("quality_inspection"),
  });
  const [updated] = await req.db!.update(qualityInspectionReports).set({ ...body, updatedAt: new Date() }).where(eq(qualityInspectionReports.id, record.id)).returning();
  await recordAuditTrail(req.db!, { entityType: "QualityInspectionReport", entityId: record.id, action: "update", changes: changesWithNumberEdit(req.body, numberChange), performedBy: req.user?.id });
  res.json(updated);
});

const INSPECTION_SIGNOFF = {
  inspector: { column: "inspectorSignature", date: "inspectorSignatureDate", description: "I certify that this inspection record is accurate." },
  qaLead: { column: "qaLeadSignature", date: "qaLeadSignatureDate", description: "I certify that I have reviewed this inspection and approve the result." },
} as const;

export const signReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadReport(req, Number(req.params.id));
  const field = req.body.field as keyof typeof INSPECTION_SIGNOFF;
  const spec = INSPECTION_SIGNOFF[field];
  const stamp = await requireSignatureStamp(req, {
    pin: req.body.pin,
    certified: req.body.certified,
    entityType: "QualityInspectionReport",
    entityId: record.id,
    field: spec.column,
    description: spec.description,
  });
  const [updated] = await req
    .db!.update(qualityInspectionReports)
    .set({ [spec.column]: stamp.stamp, [spec.date]: stamp.signedAt, updatedAt: new Date() })
    .where(eq(qualityInspectionReports.id, record.id))
    .returning();
  res.json(updated);
});

export const deleteReportHandler = asyncHandler(async (req: Request, res: Response) => {
  await deleteRecord(req, "quality_inspection");
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
  const body = applyMeasuredResult({}, req.body);
  const [created] = await req.db!.insert(qualityInspectionItems).values({ ...body, reportId: record.id }).returning();
  await recordAuditTrail(req.db!, { entityType: "QualityInspectionReport", entityId: record.id, action: "update", changes: { subAction: "item_added", ...body }, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const updateItemHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadReport(req, Number(req.params.id));
  const item = await loadItem(req, record.id, Number(req.params.itemId));
  const body = applyMeasuredResult(item, req.body);
  const [updated] = await req.db!.update(qualityInspectionItems).set({ ...body, updatedAt: new Date() }).where(eq(qualityInspectionItems.id, item.id)).returning();
  await recordAuditTrail(req.db!, { entityType: "QualityInspectionReport", entityId: record.id, action: "update", changes: { subAction: "item_updated", itemId: item.id, ...body }, performedBy: req.user?.id });
  res.json(updated);
});

export const deleteItemHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadReport(req, Number(req.params.id));
  const item = await loadItem(req, record.id, Number(req.params.itemId));
  await req.db!.delete(qualityInspectionItems).where(eq(qualityInspectionItems.id, item.id));
  await recordAuditTrail(req.db!, { entityType: "QualityInspectionReport", entityId: record.id, action: "update", changes: { subAction: "item_removed", itemId: item.id }, performedBy: req.user?.id });
  res.status(204).send();
});
