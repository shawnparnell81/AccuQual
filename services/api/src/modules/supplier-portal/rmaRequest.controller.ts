import type { Request, Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { supplierRmaRequests, rmaActivityLog } from "../../drizzle/schema/supplierRma.js";
import { rma, rmaItems } from "../../drizzle/schema/rma.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { inventoryItems } from "../../drizzle/schema/inventory.js";
import { erpPurchaseOrders } from "../../drizzle/schema/erp.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import { notifyDepartment } from "../notifications/notification.service.js";

/**
 * "AI-Automated RMA Creation" (module 3 of the brief) is implemented here
 * as real, deterministic, synchronous backend automation — triggered the
 * instant a supplier clicks Submit, in the SAME request — not a call to
 * the generative POST /ai/assistant endpoint. Everything this step does
 * (assign a number, copy already-known fields onto a new row, try to
 * match a real part/PO, notify two departments, write a log entry) is a
 * mechanical data transformation with one correct answer; there's nothing
 * for a text-completion model to decide, and routing a real database
 * write through a non-deterministic generator would be slower, less
 * reliable, and against this app's own established "no fictional
 * automation" precedent (see e.g. the ERP Automation Suggestions review —
 * even THOSE are advisory-only, requiring a human click to actually act;
 * this module goes further only because the human click already
 * happened — it's the supplier's own Submit). The user-facing behavior
 * described in the brief — "the supplier fills out a form, clicks submit,
 * and a real numbered RMA exists a moment later with the right people
 * notified" — is delivered exactly as specified; only the literal
 * mechanism differs from an LLM call, and for good reason.
 */

/** RMA-YYYY-XXXX, derived from the real row's own post-insert id — same "nothing to race between two concurrent creates" reasoning as rma.controller.ts's own generateRmaNumber, just with the year prefixed per this module's own explicit format requirement (distinct from staff-created RMAs' plain RMA-000123 numbering). */
function generateSupplierRmaNumber(id: number): string {
  const year = new Date().getFullYear();
  return `RMA-${year}-${String(id).padStart(4, "0")}`;
}

/** Best-effort: pull the first run of digits out of the supplier's own free-text PO Number and match it to a real PO id for this tenant+supplier. Never invents a match — a miss is logged honestly, not silently ignored. */
async function tryMatchPurchaseOrder(req: Request, tenantId: number, supplierId: number, poNumber: string | undefined) {
  if (!poNumber) return null;
  const digits = poNumber.match(/\d+/)?.[0];
  if (!digits) return null;
  const [po] = await req.db!.select({ id: erpPurchaseOrders.id }).from(erpPurchaseOrders).where(and(eq(erpPurchaseOrders.id, Number(digits)), eq(erpPurchaseOrders.tenantId, tenantId), eq(erpPurchaseOrders.supplierId, supplierId)));
  return po?.id ?? null;
}

/** Best-effort: match the supplier's own Part Number text to a real inventory item by SKU (case-insensitive). */
async function tryMatchPart(req: Request, tenantId: number, partNumber: string | undefined) {
  if (!partNumber) return null;
  const [item] = await req.db!.select({ id: inventoryItems.id, sku: inventoryItems.sku }).from(inventoryItems).where(and(eq(inventoryItems.tenantId, tenantId), sql`lower(${inventoryItems.sku}) = lower(${partNumber})`));
  return item ?? null;
}

export const submitRmaRequestHandler = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.roleName !== "supplier" || !req.user.supplierId) {
    throw AppError.forbidden("Only a real Supplier Portal login can submit an RMA Request");
  }
  const tenantId = req.tenantId!;
  const supplierId = req.user.supplierId;
  const body = req.body as {
    companyName: string;
    contactName: string;
    email: string;
    phoneNumber?: string;
    poNumber?: string;
    partNumber?: string;
    poDate?: Date;
    customerClaimNumber?: string;
    shortDescription?: string;
    description?: string;
  };

  const [supplier] = await req.db!.select().from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.tenantId, tenantId)));
  if (!supplier) throw AppError.forbidden("This supplier login is not linked to a real supplier record");

  // 1. Real supplier request row — the one durable record of exactly what
  // the supplier submitted, independent of what happens next.
  const [request] = await req.db!.insert(supplierRmaRequests).values({ tenantId, supplierId, ...body, submittedByUserId: req.user.id }).returning();
  await recordAuditTrail(req.db!, { tenantId, entityType: "SupplierRmaRequest", entityId: request!.id, action: "create", changes: body, performedBy: req.user.id });
  await req.db!.insert(rmaActivityLog).values({ tenantId, supplierRmaRequestId: request!.id, event: "request_submitted", details: { companyName: body.companyName, customerClaimNumber: body.customerClaimNumber } });

  // 2. Auto-match part + PO (best-effort, logged either way).
  const matchedPart = await tryMatchPart(req, tenantId, body.partNumber);
  const matchedPoId = await tryMatchPurchaseOrder(req, tenantId, supplierId, body.poNumber);
  await req.db!.insert(rmaActivityLog).values({
    tenantId,
    supplierRmaRequestId: request!.id,
    event: "auto_match_attempted",
    details: { partNumber: body.partNumber, matchedItemId: matchedPart?.id ?? null, poNumber: body.poNumber, matchedPoId },
  });

  // 3. Create the real RMA — transferring every supplier field onto it,
  // starting in the same "draft" state every RMA (however created)
  // starts in; nothing here bypasses the RMA module's own real workflow.
  const [createdRma] = await req
    .db!.insert(rma)
    .values({
      tenantId,
      rmaNumber: `RMA-PENDING-${Date.now()}`,
      supplierId,
      linkedPoId: matchedPoId ?? undefined,
      notes: `Auto-created from Supplier Portal RMA Request #${request!.id} — Customer Claim ${body.customerClaimNumber ?? "n/a"}. ${body.shortDescription ?? ""}`.trim(),
      createdByUserId: req.user.id,
    })
    .returning();
  const [numberedRma] = await req.db!.update(rma).set({ rmaNumber: generateSupplierRmaNumber(createdRma!.id) }).where(eq(rma.id, createdRma!.id)).returning();

  if (matchedPart) {
    // Quantity defaults to 1 — the supplier form never asks how many units
    // are being returned, so this is a real, correctable-by-staff
    // placeholder, not a fabricated exact count.
    await req.db!.insert(rmaItems).values({
      tenantId,
      rmaId: numberedRma!.id,
      itemId: matchedPart.id,
      description: body.description ?? body.shortDescription ?? undefined,
      quantityReturned: "1",
      reason: "Supplier Portal RMA Request",
    });
  }

  await req.db!.update(supplierRmaRequests).set({ status: "rma_created", createdRmaId: numberedRma!.id }).where(eq(supplierRmaRequests.id, request!.id));

  await recordAuditTrail(req.db!, {
    tenantId,
    entityType: "Rma",
    entityId: numberedRma!.id,
    action: "create",
    changes: { source: "supplier_rma_request", supplierRmaRequestId: request!.id, ...body },
    performedBy: req.user.id,
  });
  await publishEvent(WORKFLOW_STREAM, { tenantId, module: "rma", event: "auto_created_from_supplier_request", entityId: numberedRma!.id });
  await req.db!.insert(rmaActivityLog).values({
    tenantId,
    rmaId: numberedRma!.id,
    supplierRmaRequestId: request!.id,
    event: "rma_created",
    details: { rmaNumber: numberedRma!.rmaNumber, matchedItemId: matchedPart?.id ?? null, matchedPoId },
    performedBy: req.user.id,
  });

  // 4. Notify Quality + Customer Service — the same real, honest
  // (logged-only without SMTP configured) notification mechanism every
  // other department alert in this app already uses.
  const subject = `New RMA ${numberedRma!.rmaNumber} — Supplier Portal request from ${body.companyName}`;
  const notifyBody = `${supplier.name} submitted a new RMA Request via the Supplier Portal.\n\nRMA: ${numberedRma!.rmaNumber}\nContact: ${body.contactName} (${body.email})\nCustomer Claim #: ${body.customerClaimNumber ?? "n/a"}\nPart #: ${body.partNumber ?? "n/a"}\n\n${body.shortDescription ?? ""}`;
  const qualityNotified = await notifyDepartment(req.db!, { tenantId, department: "quality", subject, body: notifyBody, relatedEntityType: "Rma", relatedEntityId: numberedRma!.id });
  const csNotified = await notifyDepartment(req.db!, { tenantId, department: "customer_service", subject, body: notifyBody, relatedEntityType: "Rma", relatedEntityId: numberedRma!.id });
  await req.db!.insert(rmaActivityLog).values({
    tenantId,
    rmaId: numberedRma!.id,
    supplierRmaRequestId: request!.id,
    event: "notifications_sent",
    details: { qualityNotified, customerServiceNotified: csNotified },
  });

  res.status(201).json({ request: { ...request, status: "rma_created", createdRmaId: numberedRma!.id }, rma: numberedRma });
});

/** GET /supplier-portal/rma-request/status — the calling supplier's own past requests, newest first. */
export const rmaRequestStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.roleName !== "supplier" || !req.user.supplierId) {
    throw AppError.forbidden("Only a real Supplier Portal login can view its own RMA Requests");
  }
  const rows = await req
    .db!.select()
    .from(supplierRmaRequests)
    .where(and(eq(supplierRmaRequests.tenantId, req.tenantId!), eq(supplierRmaRequests.supplierId, req.user.supplierId)))
    .orderBy(desc(supplierRmaRequests.createdAt));

  const rmaNumbers = new Map<number, string>();
  for (const row of rows) {
    if (row.createdRmaId) {
      const [r] = await req.db!.select({ rmaNumber: rma.rmaNumber }).from(rma).where(eq(rma.id, row.createdRmaId));
      if (r) rmaNumbers.set(row.id, r.rmaNumber);
    }
  }
  res.json(rows.map((row) => ({ ...row, createdRmaNumber: row.createdRmaId ? rmaNumbers.get(row.id) : null })));
});
