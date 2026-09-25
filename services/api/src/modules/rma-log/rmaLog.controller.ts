import type { Request, Response } from "express";
import { and, eq, ilike, gte, lte, desc, type SQL } from "drizzle-orm";
import { rmaLogRecords } from "../../drizzle/schema/rmaLog.js";
import { warrantyClaims } from "../../drizzle/schema/warranty.js";
import { supplierRmaRequests } from "../../drizzle/schema/supplierRma.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail, recordAuditTrailStandalone } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import { getUserAccessLevel } from "../../middleware/departmentAccess.js";
import type { TenantDb } from "../../lib/tenantScope.js";
import { pool } from "../../db/index.js";

/** A fixed, linear lifecycle matching the field list's own natural progression — see rmaLog.validation.ts's own comment. completed (closed) is terminal. */
const ALLOWED_NEXT: Record<string, string[]> = {
  open: ["received"],
  received: ["under_review"],
  under_review: ["dispositioned"],
  dispositioned: ["closed"],
  closed: [],
};

/** RMA-YYYY-XXXX, derived from the real row's own post-insert id — same convention rmaRequest.controller.ts's generateSupplierRmaNumber already established for a customer-facing (as opposed to rma.controller.ts's plain RMA-000123 supplier-facing) numbering format. */
function generateRmaLogNumber(id: number): string {
  const year = new Date().getFullYear();
  return `RMA-${year}-${String(id).padStart(4, "0")}`;
}

const LINK_FIELDS = ["warrantyId", "supplierRmaRequestId", "qualityId"] as const;

function isAdmin(req: Request): boolean {
  return req.user?.roleName === "admin" || req.user?.roleName === "platform_admin";
}

async function loadRmaLog(req: Request, id: number) {
  const [row] = await req.db!.select().from(rmaLogRecords).where(and(eq(rmaLogRecords.id, id)));
  if (!row) throw AppError.notFound("RmaLog");
  return row;
}

async function validateLinks(req: Request, body: Record<string, unknown>) {
  if (body.warrantyId !== undefined && body.warrantyId !== null) {
    const [w] = await req.db!.select({ id: warrantyClaims.id }).from(warrantyClaims).where(and(eq(warrantyClaims.id, body.warrantyId as number)));
    if (!w) throw AppError.badRequest(`Warranty claim #${body.warrantyId} not found`);
  }
  if (body.supplierRmaRequestId !== undefined && body.supplierRmaRequestId !== null) {
    const [s] = await req.db!.select({ id: supplierRmaRequests.id }).from(supplierRmaRequests).where(and(eq(supplierRmaRequests.id, body.supplierRmaRequestId as number)));
    if (!s) throw AppError.badRequest(`Supplier RMA Request #${body.supplierRmaRequestId} not found`);
  }
  if (body.qualityId !== undefined && body.qualityId !== null) {
    const [n] = await req.db!.select({ id: ncr.id }).from(ncr).where(and(eq(ncr.id, body.qualityId as number)));
    if (!n) throw AppError.badRequest(`NCR #${body.qualityId} not found`);
  }
}

/** GET /rma-log?status=&partNumber=&customerName=&dateFrom=&dateTo=&q= (q searches rmaNumber). */
export const listRmaLogHandler = asyncHandler(async (req: Request, res: Response) => {
  const { status, partNumber, customerName, dateFrom, dateTo, q } = req.query as Record<string, string | undefined>;
  const conditions: SQL[] = [];
  if (status) conditions.push(eq(rmaLogRecords.status, status));
  if (partNumber) conditions.push(ilike(rmaLogRecords.partNumber, `%${partNumber}%`));
  if (customerName) conditions.push(ilike(rmaLogRecords.customerName, `%${customerName}%`));
  if (dateFrom) conditions.push(gte(rmaLogRecords.dateIssued, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(rmaLogRecords.dateIssued, new Date(dateTo)));
  if (q) conditions.push(ilike(rmaLogRecords.rmaNumber, `%${q}%`));

  const rows = await req
    .db!.select({
      id: rmaLogRecords.id,
      rmaNumber: rmaLogRecords.rmaNumber,
      status: rmaLogRecords.status,
      dateIssued: rmaLogRecords.dateIssued,
      customerName: rmaLogRecords.customerName,
      partNumber: rmaLogRecords.partNumber,
      partDescription: rmaLogRecords.partDescription,
      quantityReturned: rmaLogRecords.quantityReturned,
      dispositionAction: rmaLogRecords.dispositionAction,
      dateClosed: rmaLogRecords.dateClosed,
      createdAt: rmaLogRecords.createdAt,
    })
    .from(rmaLogRecords)
    .where(and(...conditions))
    .orderBy(desc(rmaLogRecords.createdAt));
  res.json(rows);
});

/** POST /rma-log — the "Add New" button's endpoint. Router already requires rma_log edit; every field is open to whoever has that (no separate create-only carve-out in the brief, unlike CRAR's quality-only rule). Prepopulates rmaNumber + dateIssued exactly as the brief's own "Add New" behavior spec describes. */
export const createRmaLogHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  await validateLinks(req, body);

  const [created] = await req
    .db!.insert(rmaLogRecords)
    .values({ rmaNumber: `RMA-PENDING-${Date.now()}`, dateIssued: (body.dateIssued as Date) ?? new Date(), ...body, createdByUserId: req.user?.id })
    .returning();
  const [numbered] = await req.db!.update(rmaLogRecords).set({ rmaNumber: generateRmaLogNumber(created!.id) }).where(eq(rmaLogRecords.id, created!.id)).returning();

  await recordAuditTrail(req.db!, { entityType: "RmaLog", entityId: numbered!.id, action: "create", changes: req.body, performedBy: req.user?.id });
  res.status(201).json(numbered);
});

export const getRmaLogHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadRmaLog(req, Number(req.params.id));
  const [warranty] = record.warrantyId ? await req.db!.select().from(warrantyClaims).where(eq(warrantyClaims.id, record.warrantyId)) : [null];
  const [supplierRequest] = record.supplierRmaRequestId ? await req.db!.select().from(supplierRmaRequests).where(eq(supplierRmaRequests.id, record.supplierRmaRequestId)) : [null];
  const [linkedNcr] = record.qualityId ? await req.db!.select().from(ncr).where(eq(ncr.id, record.qualityId)) : [null];

  res.json({
    ...record,
    warranty: warranty ? { id: warranty.id, claimNumber: warranty.claimNumber, status: warranty.status } : null,
    supplierRequest: supplierRequest ? { id: supplierRequest.id, companyName: supplierRequest.companyName, status: supplierRequest.status } : null,
    linkedNcr: linkedNcr ? { id: linkedNcr.id, title: linkedNcr.title, status: linkedNcr.status } : null,
  });
});

/**
 * PATCH /rma-log/:id — router already requires rma_log edit for the
 * content fields (17-column list); the 3 linkage fields (warrantyId/
 * supplierRmaRequestId/qualityId) additionally require rma_log_linkage
 * edit — a real, separate, database-configurable lever per the brief's own
 * "rma_log.linkage.write" permission, same "matrix grants edit, a narrower
 * DB-driven permission gates one subset of fields" pattern CRAR/Warranty
 * already use with hardcoded department arrays, just genuinely
 * self-service here instead.
 */
export const updateRmaLogHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadRmaLog(req, Number(req.params.id));
  if (record.status === "closed") throw AppError.badRequest("This RMA Log entry is closed and can no longer be edited");

  const touchesLinkFields = LINK_FIELDS.some((f) => f in req.body);
  if (touchesLinkFields && !isAdmin(req)) {
    const linkageLevel = await getUserAccessLevel(req.db! as TenantDb, req.user!, "rma_log_linkage");
    if (linkageLevel !== "edit") {
      await recordAuditTrailStandalone(pool, {
        entityType: "RmaLog",
        entityId: record.id,
        action: "permission_denied",
        changes: { attemptedAction: "update_linkage", fields: LINK_FIELDS.filter((f) => f in req.body) },
        performedBy: req.user?.id,
      });
      throw AppError.forbidden("Linking an RMA Log entry to a warranty claim, supplier RMA request, or NCR requires the rma_log.linkage.write permission");
    }
  }

  await validateLinks(req, req.body as Record<string, unknown>);

  const [updated] = await req
    .db!.update(rmaLogRecords)
    .set({ ...req.body, updatedAt: new Date() })
    .where(eq(rmaLogRecords.id, record.id))
    .returning();
  await recordAuditTrail(req.db!, { entityType: "RmaLog", entityId: record.id, action: "update", changes: req.body, performedBy: req.user?.id });
  res.json(updated);
});

/**
 * POST /rma-log/:id/status — gated on rma_log_status edit specifically
 * (the brief's own "rma_log.status.write"), independent of the base
 * rma_log edit level a user needs just to reach this route at all.
 * Auto-stamps dateReceived/dateClosed the moment the record actually
 * enters those stages — never client-supplied, same "server stamps the
 * real moment it happened" rule every other workflow timestamp in this
 * app follows (see e.g. warranty.controller.ts's operator/inspector
 * signedAt fields).
 */
export const transitionRmaLogHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadRmaLog(req, Number(req.params.id));
  const { status: newStatus } = req.body as { status: string };

  if (!ALLOWED_NEXT[record.status]?.includes(newStatus)) {
    throw AppError.badRequest(`Cannot move an RMA Log entry from "${record.status}" to "${newStatus}"`);
  }

  if (!isAdmin(req)) {
    const statusLevel = await getUserAccessLevel(req.db! as TenantDb, req.user!, "rma_log_status");
    if (statusLevel !== "edit") {
      await recordAuditTrailStandalone(pool, {
        entityType: "RmaLog",
        entityId: record.id,
        action: "permission_denied",
        changes: { attemptedAction: "status_change", fromStatus: record.status, toStatus: newStatus },
        performedBy: req.user?.id,
      });
      throw AppError.forbidden("Changing an RMA Log entry's status requires the rma_log.status.write permission");
    }
  }

  const patch: Record<string, unknown> = { status: newStatus, updatedAt: new Date() };
  if (newStatus === "received" && !record.dateReceived) patch.dateReceived = new Date();
  if (newStatus === "closed" && !record.dateClosed) patch.dateClosed = new Date();

  const [updated] = await req.db!.update(rmaLogRecords).set(patch).where(eq(rmaLogRecords.id, record.id)).returning();

  await recordAuditTrail(req.db!, {
    entityType: "RmaLog",
    entityId: record.id,
    action: "status_change",
    changes: { oldStatus: record.status, newStatus, userId: req.user?.id },
    performedBy: req.user?.id,
  });
  await publishEvent(WORKFLOW_STREAM, { module: "rma_log", event: newStatus, entityId: record.id });

  res.json(updated);
});
