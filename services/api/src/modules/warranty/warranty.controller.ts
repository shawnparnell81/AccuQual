import type { Request, Response } from "express";
import { mkdir, writeFile } from "node:fs/promises";
import { and, eq, gte, lte, ilike, desc, sql, type SQL } from "drizzle-orm";
import { warrantyClaims, warrantyClaimCosts, warrantyClaimWorkflow } from "../../drizzle/schema/warranty.js";
import { attachments } from "../../drizzle/schema/attachments.js";
import { customers } from "../../drizzle/schema/customers.js";
import { inventoryItems } from "../../drizzle/schema/inventory.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { workOrders } from "../../drizzle/schema/workOrders.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { env } from "../../config/env.js";
import { recordAuditTrail, resolveUserNames } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import { getUserAccessLevel } from "../../middleware/departmentAccess.js";
import type { TenantDb } from "../../lib/tenantScope.js";

/** Same inline-guard style as rma.controller.ts/inventory.controller.ts's assertDepartment — used for the one thing left that's a real fixed business rule (which stage of the workflow belongs to whom) rather than a tunable access level. */
function assertDepartment(req: Request, allowed: string[]) {
  const role = req.user?.roleName;
  if (role === "admin" || role === "platform_admin") return;
  const department = req.user?.department;
  if (!department || !allowed.includes(department)) {
    throw AppError.forbidden(`This action requires department: ${allowed.join(" or ")}`);
  }
}

function isAdmin(req: Request): boolean {
  return req.user?.roleName === "admin" || req.user?.roleName === "platform_admin";
}

/**
 * Module-specific RBAC build (2026-09-16): create/update/upload used to be
 * hardcoded to a fixed department list, bypassing the Roles & Permissions
 * module's own "warranty" access level for any OTHER department. Now a
 * live DB check (warranty.write) — any department with "edit" on warranty
 * may fully create/edit a claim, EXCEPT purchasing, whose real carve-out
 * (cost entries only — see createWarrantyCostHandler) is a genuine
 * structural business rule, not a tunable level, and stays hardcoded.
 * Default behavior is bit-for-bit unchanged; the new capability is purely
 * additive (grant e.g. sales_and_marketing "edit" on warranty and they
 * gain full create/edit rights too, without touching this function).
 */
async function assertWarrantyContentWrite(req: Request) {
  if (isAdmin(req)) return;
  if (req.user?.department === "purchasing") {
    throw AppError.forbidden("Purchasing may only record cost entries on a warranty claim, not create or edit its content");
  }
  const level = await getUserAccessLevel(req.db! as TenantDb, req.user!, "warranty");
  if (level !== "edit") {
    throw AppError.forbidden("This action requires edit access to Warranty (warranty.write)");
  }
}

/** A fixed lifecycle graph — see the Warranty module's WORKFLOW section. rejected may still be closed out; replaced/repaired/closed are terminal. */
const ALLOWED_NEXT: Record<string, string[]> = {
  new: ["inspection"],
  inspection: ["supplier_review"],
  supplier_review: ["approved", "rejected"],
  approved: ["replaced", "repaired"],
  rejected: ["closed"],
  replaced: ["closed"],
  repaired: ["closed"],
  closed: [],
};

/** Which department(s) may move a claim TO this target status. Quality holds the real disposition authority (supplier_review -> approved/rejected), same role it has on NCR/CAPA; engineering shares inspection duty; customer_service handles fulfillment/closing once a disposition is made. admin bypasses this entirely (see isAdmin() above). */
const STATUS_TRANSITION_DEPARTMENTS: Record<string, string[]> = {
  inspection: ["quality", "engineering"],
  supplier_review: ["quality", "engineering"],
  approved: ["quality"],
  rejected: ["quality"],
  replaced: ["quality", "customer_service"],
  repaired: ["quality", "customer_service"],
  closed: ["quality", "customer_service"],
};

function generateClaimNumber(id: number): string {
  return `WC-${String(id).padStart(6, "0")}`;
}

async function loadClaim(req: Request, id: number) {
  const [row] = await req.db!.select().from(warrantyClaims).where(and(eq(warrantyClaims.id, id)));
  if (!row) throw AppError.notFound("WarrantyClaim");
  return row;
}

export const listWarrantyClaimsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { status, customerId, supplierId, dateFrom, dateTo, q } = req.query as Record<string, string | undefined>;
  const conditions: SQL[] = [];
  if (status) conditions.push(eq(warrantyClaims.status, status));
  if (customerId) conditions.push(eq(warrantyClaims.customerId, Number(customerId)));
  if (supplierId) conditions.push(eq(warrantyClaims.supplierId, Number(supplierId)));
  if (dateFrom) conditions.push(gte(warrantyClaims.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(warrantyClaims.createdAt, new Date(dateTo)));
  if (q) conditions.push(ilike(warrantyClaims.claimNumber, `%${q}%`));

  const rows = await req
    .db!.select({
      id: warrantyClaims.id,
      claimNumber: warrantyClaims.claimNumber,
      status: warrantyClaims.status,
      customerId: warrantyClaims.customerId,
      customerName: customers.legalName,
      serialNumber: warrantyClaims.serialNumber,
      failureDate: warrantyClaims.failureDate,
      warrantyCostEstimate: warrantyClaims.warrantyCostEstimate,
      warrantyActualCost: warrantyClaims.warrantyActualCost,
      supplierId: warrantyClaims.supplierId,
      createdAt: warrantyClaims.createdAt,
      updatedAt: warrantyClaims.updatedAt,
    })
    .from(warrantyClaims)
    .leftJoin(customers, eq(warrantyClaims.customerId, customers.id))
    .where(and(...conditions))
    .orderBy(desc(warrantyClaims.createdAt));
  res.json(rows);
});

export const createWarrantyClaimHandler = asyncHandler(async (req: Request, res: Response) => {
  // Intake is Customer Service's usual first touch on a failure report;
  // Quality may also open one directly (e.g. raised from an internal
  // finding). Real, deliberate FK lookups (not letting a bad id fall
  // through to a raw constraint violation) — same pattern rma.controller.ts
  // uses for supplierId/linkedNcrId.
  await assertWarrantyContentWrite(req);
  const body = req.body as {
    customerId?: number;
    productId?: number;
    serialNumber?: string;
    purchaseDate?: Date;
    failureDate?: Date;
    failureDescription?: string;
    warrantyCostEstimate?: number;
    supplierId?: number;
    linkedNcrId?: number;
    linkedWorkOrderId?: number;
  };

  if (body.customerId !== undefined) {
    const [row] = await req.db!.select({ id: customers.id }).from(customers).where(and(eq(customers.id, body.customerId)));
    if (!row) throw AppError.badRequest(`Customer #${body.customerId} not found`);
  }
  if (body.productId !== undefined) {
    const [row] = await req.db!.select({ id: inventoryItems.id }).from(inventoryItems).where(and(eq(inventoryItems.id, body.productId)));
    if (!row) throw AppError.badRequest(`Product #${body.productId} not found`);
  }
  if (body.supplierId !== undefined) {
    const [row] = await req.db!.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, body.supplierId)));
    if (!row) throw AppError.badRequest(`Supplier #${body.supplierId} not found`);
  }
  if (body.linkedNcrId !== undefined) {
    const [row] = await req.db!.select({ id: ncr.id }).from(ncr).where(and(eq(ncr.id, body.linkedNcrId)));
    if (!row) throw AppError.badRequest(`NCR #${body.linkedNcrId} not found`);
  }
  if (body.linkedWorkOrderId !== undefined) {
    const [row] = await req.db!.select({ id: workOrders.id }).from(workOrders).where(and(eq(workOrders.id, body.linkedWorkOrderId)));
    if (!row) throw AppError.badRequest(`Work Order #${body.linkedWorkOrderId} not found`);
  }

  const [created] = await req
    .db!.insert(warrantyClaims)
    .values({
      // Placeholder — real value written right after, same reasoning as
      // rma.ts's generateRmaNumber (derived from the row's own post-insert
      // id, nothing to race between two concurrent creates).
      claimNumber: `WC-PENDING-${Date.now()}`,
      ...body,
      warrantyCostEstimate: body.warrantyCostEstimate !== undefined ? String(body.warrantyCostEstimate) : undefined,
      createdByUserId: req.user?.id,
    })
    .returning();

  const [withNumber] = await req.db!.update(warrantyClaims).set({ claimNumber: generateClaimNumber(created!.id) }).where(eq(warrantyClaims.id, created!.id)).returning();

  await req.db!.insert(warrantyClaimWorkflow).values({ claimId: withNumber!.id, fromStatus: null, toStatus: "new", performedByUserId: req.user?.id });
  await recordAuditTrail(req.db!, { entityType: "WarrantyClaim", entityId: withNumber!.id, action: "create", changes: req.body, performedBy: req.user?.id });
  res.status(201).json(withNumber);
});

export const getWarrantyClaimHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadClaim(req, Number(req.params.id));
  const [customer] = record.customerId ? await req.db!.select().from(customers).where(eq(customers.id, record.customerId)) : [null];
  const [product] = record.productId ? await req.db!.select().from(inventoryItems).where(eq(inventoryItems.id, record.productId)) : [null];
  const [supplier] = record.supplierId ? await req.db!.select().from(suppliers).where(eq(suppliers.id, record.supplierId)) : [null];
  const [linkedNcr] = record.linkedNcrId ? await req.db!.select().from(ncr).where(eq(ncr.id, record.linkedNcrId)) : [null];
  const [linkedWorkOrder] = record.linkedWorkOrderId ? await req.db!.select().from(workOrders).where(eq(workOrders.id, record.linkedWorkOrderId)) : [null];
  const costs = await req.db!.select().from(warrantyClaimCosts).where(and(eq(warrantyClaimCosts.claimId, record.id))).orderBy(desc(warrantyClaimCosts.createdAt));
  const workflowRows = await req.db!.select().from(warrantyClaimWorkflow).where(and(eq(warrantyClaimWorkflow.claimId, record.id))).orderBy(desc(warrantyClaimWorkflow.createdAt));
  // Phase 0 audit-trail fix: performedByUserId was always captured here but
  // never resolved to a name — the claim detail page's History list showed
  // no actor at all. Same resolver every other module's history view uses.
  const actorNames = await resolveUserNames(req.db! as TenantDb, workflowRows.map((w) => w.performedByUserId));
  const workflow = workflowRows.map((w) => ({ ...w, performedByName: w.performedByUserId === null ? null : (actorNames.get(w.performedByUserId) ?? null) }));

  res.json({
    ...record,
    customer: customer ? { id: customer.id, legalName: customer.legalName } : null,
    product: product ? { id: product.id, sku: product.sku, description: product.description } : null,
    supplier: supplier ? { id: supplier.id, name: supplier.name, status: supplier.status } : null,
    linkedNcr: linkedNcr ? { id: linkedNcr.id, title: linkedNcr.title, status: linkedNcr.status } : null,
    linkedWorkOrder: linkedWorkOrder ? { id: linkedWorkOrder.id, status: linkedWorkOrder.status } : null,
    costs,
    workflow,
  });
});

/** POST /warranty/claims/:id/update — the spec's own literal path (not PATCH) for updating claim fields. */
export const updateWarrantyClaimHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadClaim(req, Number(req.params.id));
  if (record.status === "closed") throw AppError.badRequest("This claim is closed and can no longer be edited");
  await assertWarrantyContentWrite(req);

  const [updated] = await req
    .db!.update(warrantyClaims)
    .set({ ...req.body, updatedAt: new Date() })
    .where(eq(warrantyClaims.id, record.id))
    .returning();
  await recordAuditTrail(req.db!, { entityType: "WarrantyClaim", entityId: record.id, action: "update", changes: req.body, performedBy: req.user?.id });
  res.json(updated);
});

export const transitionWarrantyClaimHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadClaim(req, Number(req.params.id));
  const { status: newStatus, note } = req.body as { status: string; note?: string };

  if (!ALLOWED_NEXT[record.status]?.includes(newStatus)) {
    throw AppError.badRequest(`Cannot move a warranty claim from "${record.status}" to "${newStatus}"`);
  }
  if (!isAdmin(req)) assertDepartment(req, STATUS_TRANSITION_DEPARTMENTS[newStatus] ?? []);

  const [updated] = await req
    .db!.update(warrantyClaims)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(warrantyClaims.id, record.id))
    .returning();

  await req.db!.insert(warrantyClaimWorkflow).values({ claimId: record.id, fromStatus: record.status, toStatus: newStatus, note, performedByUserId: req.user?.id });
  await recordAuditTrail(req.db!, {
    entityType: "WarrantyClaim",
    entityId: record.id,
    action: "status_change",
    changes: { oldStatus: record.status, newStatus, note, userId: req.user?.id },
    performedBy: req.user?.id,
  });
  // Opt-in only: lets a tenant build automation on warranty events in the
  // existing Workflow Builder, same as rma/inventory/erp already allow.
  await publishEvent(WORKFLOW_STREAM, { module: "warranty", event: newStatus, entityId: record.id });

  res.json(updated);
});

/**
 * A real file, tagged onto the SAME generic `attachments` table every other
 * record's evidence uses (see warranty.ts's own schema comment) — not a
 * second, parallel upload mechanism. Also indexes the upload into the
 * claim's own failureImages/documents jsonb summary field, per `category`.
 */
export const uploadWarrantyDocumentHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadClaim(req, Number(req.params.id));
  await assertWarrantyContentWrite(req);
  const file = req.file;
  if (!file) throw AppError.badRequest("No file uploaded");
  const category = (req.body.category as string | undefined) === "failure_image" ? "failure_image" : "document";
  const caption = req.body.caption as string | undefined;

  const dir = `${env.STORAGE_LOCAL_PATH}/tenants/${req.tenantId}/warranty`;
  await mkdir(dir, { recursive: true });
  const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${dir}/${record.id}-${Date.now()}-${safeName}`;
  await writeFile(path, file.buffer);

  const [attachment] = await req
    .db!.insert(attachments)
    .values({
      entityType: "warranty_claim",
      entityId: record.id,
      fileName: file.originalname,
      filePath: path,
      mimeType: file.mimetype,
      fileSize: file.size,
      uploadedBy: req.user?.id,
    })
    .returning();

  const field = category === "failure_image" ? "failureImages" : "documents";
  const existing = (record[field] as { attachmentId: number; caption?: string }[] | null) ?? [];
  const nextValue = [...existing, { attachmentId: attachment!.id, caption }];
  const [updated] = await req
    .db!.update(warrantyClaims)
    .set({ [field]: nextValue, updatedAt: new Date() })
    .where(eq(warrantyClaims.id, record.id))
    .returning();

  await recordAuditTrail(req.db!, {
    entityType: "WarrantyClaim",
    entityId: record.id,
    action: "update",
    changes: { uploadedDocument: file.originalname, category },
    performedBy: req.user?.id,
  });
  res.status(201).json({ attachment, claim: updated });
});

export const listWarrantyCostsHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadClaim(req, Number(req.params.id));
  const rows = await req.db!.select().from(warrantyClaimCosts).where(and(eq(warrantyClaimCosts.claimId, record.id))).orderBy(desc(warrantyClaimCosts.createdAt));
  res.json(rows);
});

/** Recomputes warrantyActualCost as a real running sum on the claim itself, not left for callers to compute client-side. */
export const createWarrantyCostHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadClaim(req, Number(req.params.id));
  // Cost entry is the money side — Quality records the actuals it verifies,
  // Purchasing records what a supplier invoice actually charged.
  assertDepartment(req, ["quality", "purchasing"]);
  const { costType, amount, notes } = req.body as { costType: string; amount: number; notes?: string };

  const [created] = await req
    .db!.insert(warrantyClaimCosts)
    .values({ claimId: record.id, costType, amount: String(amount), notes, recordedByUserId: req.user?.id })
    .returning();

  const [totalRow] = await req
    .db!.select({ total: sql<string>`coalesce(sum(${warrantyClaimCosts.amount}), 0)` })
    .from(warrantyClaimCosts)
    .where(and(eq(warrantyClaimCosts.claimId, record.id)));
  await req.db!.update(warrantyClaims).set({ warrantyActualCost: totalRow?.total ?? "0", updatedAt: new Date() }).where(eq(warrantyClaims.id, record.id));

  await recordAuditTrail(req.db!, { entityType: "WarrantyClaim", entityId: record.id, action: "update", changes: { addedCost: created }, performedBy: req.user?.id });
  res.status(201).json(created);
});

/** GET /warranty/analytics — powers WarrantyDashboard.tsx: counts by status, total/average cost, and average days spent in each state (from the workflow timeline). */
export const warrantyAnalyticsHandler = asyncHandler(async (req: Request, res: Response) => {
  const claims = await req.db!.select().from(warrantyClaims);

  const byStatus: Record<string, number> = {};
  let totalEstimate = 0;
  let totalActual = 0;
  for (const c of claims) {
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
    totalEstimate += c.warrantyCostEstimate ? Number(c.warrantyCostEstimate) : 0;
    totalActual += c.warrantyActualCost ? Number(c.warrantyActualCost) : 0;
  }

  const workflowRows = await req.db!.select().from(warrantyClaimWorkflow).orderBy(warrantyClaimWorkflow.claimId, warrantyClaimWorkflow.createdAt);
  const daysInStatus: Record<string, { totalDays: number; count: number }> = {};
  const byClaimId = new Map<number, typeof workflowRows>();
  for (const row of workflowRows) {
    const list = byClaimId.get(row.claimId) ?? [];
    list.push(row);
    byClaimId.set(row.claimId, list);
  }
  for (const rows of byClaimId.values()) {
    for (let i = 0; i < rows.length - 1; i++) {
      const durationMs = rows[i + 1]!.createdAt!.getTime() - rows[i]!.createdAt!.getTime();
      const status = rows[i]!.toStatus;
      const entry = daysInStatus[status] ?? { totalDays: 0, count: 0 };
      entry.totalDays += durationMs / (1000 * 60 * 60 * 24);
      entry.count += 1;
      daysInStatus[status] = entry;
    }
  }
  const averageDaysInStatus = Object.fromEntries(Object.entries(daysInStatus).map(([status, { totalDays, count }]) => [status, Number((totalDays / count).toFixed(1))]));

  res.json({
    totalClaims: claims.length,
    byStatus,
    totalCostEstimate: totalEstimate,
    totalActualCost: totalActual,
    averageDaysInStatus,
  });
});
