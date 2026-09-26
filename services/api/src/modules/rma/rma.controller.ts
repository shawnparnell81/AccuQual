import type { Request, Response } from "express";
import { and, eq, gte, lte, ilike, desc, type SQL } from "drizzle-orm";
import { rma, rmaItems } from "../../drizzle/schema/rma.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { capa } from "../../drizzle/schema/capa.js";
import { inventoryItems } from "../../drizzle/schema/inventory.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";

/** Same inline-guard style as inventory.controller.ts/erp.controller.ts's assertDepartment — the department PERMISSION_MATRIX entry is binary (read/edit) and can't express these per-action splits on its own. */
function assertDepartment(req: Request, allowed: string[]) {
  const role = req.user?.roleName;
  if (role === "admin") return;
  const department = req.user?.department;
  if (!department || !allowed.includes(department)) {
    throw AppError.forbidden(`This action requires department: ${allowed.join(" or ")}`);
  }
}

function isAdmin(req: Request): boolean {
  return req.user?.roleName === "admin";
}

/**
 * Which target status a transition to is allowed for, per the RMA spec's
 * permissions table: "purchasing: can submit, approve, close" / "material_
 * management: can submit, cancel" / "Only admin/purchasing can close". Both
 * full-access departments are allowed the two logistics-only states
 * (in_transit/received_by_supplier) — the spec doesn't single those two out,
 * and both departments already have "full RMA access". admin bypasses this
 * entirely (see isAdmin() above), same as every department gate in this app.
 */
const STATUS_TRANSITION_DEPARTMENTS: Record<string, string[]> = {
  submitted_to_supplier: ["purchasing", "material_management"],
  approved_by_supplier: ["purchasing"],
  in_transit: ["purchasing", "material_management"],
  received_by_supplier: ["purchasing", "material_management"],
  closed: ["purchasing"],
  cancelled: ["purchasing", "material_management"],
};

/** A fixed, linear lifecycle — see the RMA module's WORKFLOW section. No status may be skipped, and closed/cancelled are both terminal. */
const ALLOWED_NEXT: Record<string, string[]> = {
  draft: ["submitted_to_supplier", "cancelled"],
  submitted_to_supplier: ["approved_by_supplier", "cancelled"],
  approved_by_supplier: ["in_transit", "cancelled"],
  in_transit: ["received_by_supplier", "cancelled"],
  received_by_supplier: ["closed", "cancelled"],
  closed: [],
  cancelled: [],
};

/** Fields quality may touch on an existing RMA — "can link NCR/CAPA, can add notes, cannot submit or close" (the spec's own words). Everything else on PATCH is purchasing/material_management/admin only. */
const QUALITY_EDITABLE_FIELDS = ["linkedNcrId", "linkedCapaId", "notes"];

async function loadRma(req: Request, id: number) {
  const [row] = await req.db!.select().from(rma).where(and(eq(rma.id, id)));
  if (!row) throw AppError.notFound("Rma");
  return row;
}

/**
 * Derived from the row's own serial id, after insert — not a separate
 * counter table (nothing to race between two concurrent creates) and not
 * guessed from a pre-insert COUNT(*) (which two simultaneous requests could
 * both read before either commits). Zero-padded to 6 digits purely for a
 * tidy, consistent look on supplier-facing paperwork.
 */
function generateRmaNumber(id: number): string {
  return `RMA-${String(id).padStart(6, "0")}`;
}

async function itemsWithContext(req: Request, rmaId: number) {
  const items = await req.db!.select().from(rmaItems).where(and(eq(rmaItems.rmaId, rmaId)));
  const itemIds = items.map((i) => i.itemId);
  if (itemIds.length === 0) return [];
  const invItems = await req.db!.select().from(inventoryItems);
  const invById = new Map(invItems.map((i) => [i.id, i]));
  return items.map((i) => ({ ...i, sku: invById.get(i.itemId)?.sku ?? null }));
}

export const listRmaHandler = asyncHandler(async (req: Request, res: Response) => {
  const { status, supplierId, reasonCode, dateFrom, dateTo, q } = req.query as Record<string, string | undefined>;
  const conditions: SQL[] = [];
  if (status) conditions.push(eq(rma.status, status));
  if (supplierId) conditions.push(eq(rma.supplierId, Number(supplierId)));
  if (reasonCode) conditions.push(eq(rma.reasonCode, reasonCode));
  if (dateFrom) conditions.push(gte(rma.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(rma.createdAt, new Date(dateTo)));
  if (q) conditions.push(ilike(rma.rmaNumber, `%${q}%`));

  const rows = await req
    .db!.select({
      id: rma.id,
      rmaNumber: rma.rmaNumber,
      status: rma.status,
      supplierId: rma.supplierId,
      supplierName: suppliers.name,
      reasonCode: rma.reasonCode,
      linkedNcrId: rma.linkedNcrId,
      linkedCapaId: rma.linkedCapaId,
      createdAt: rma.createdAt,
      updatedAt: rma.updatedAt,
      notes: rma.notes,
    })
    .from(rma)
    .innerJoin(suppliers, eq(rma.supplierId, suppliers.id))
    .where(and(...conditions))
    .orderBy(desc(rma.createdAt));
  res.json(rows);
});

export const createRmaHandler = asyncHandler(async (req: Request, res: Response) => {
  // "full RMA access" (create included) is purchasing/material_management;
  // quality's spec'd access ("link NCR/CAPA, add notes") is edit-existing
  // only, not create-new.
  assertDepartment(req, ["purchasing", "material_management"]);
  const { supplierId, reasonCode, linkedNcrId, linkedCapaId, notes } = req.body as {
    supplierId: number;
    reasonCode?: string;
    linkedNcrId?: number;
    linkedCapaId?: number;
    notes?: string;
  };

  // Real, deliberate lookups (not letting a bad id fall through to a raw FK
  // violation) — found live while smoke-testing against a fresh database
  // with no seeded suppliers: an invalid supplierId previously surfaced as
  // an opaque 500 instead of a clean 400 naming the actual problem.
  const [supplier] = await req.db!.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, supplierId)));
  if (!supplier) throw AppError.badRequest(`Supplier #${supplierId} not found`);
  if (linkedNcrId !== undefined) {
    const [linked] = await req.db!.select({ id: ncr.id }).from(ncr).where(and(eq(ncr.id, linkedNcrId)));
    if (!linked) throw AppError.badRequest(`NCR #${linkedNcrId} not found`);
  }
  if (linkedCapaId !== undefined) {
    const [linked] = await req.db!.select({ id: capa.id }).from(capa).where(and(eq(capa.id, linkedCapaId)));
    if (!linked) throw AppError.badRequest(`CAPA #${linkedCapaId} not found`);
  }

  const [created] = await req
    .db!.insert(rma)
    .values({
      // Placeholder, real value written right after — rmaNumber is NOT NULL
      // UNIQUE and derived from the id this insert produces (see
      // generateRmaNumber's own comment), so it can't be known before insert.
      rmaNumber: `RMA-PENDING-${Date.now()}`,
      supplierId,
      reasonCode,
      linkedNcrId,
      linkedCapaId,
      notes,
      createdByUserId: req.user?.id,
    })
    .returning();

  const [withNumber] = await req.db!.update(rma).set({ rmaNumber: generateRmaNumber(created!.id) }).where(eq(rma.id, created!.id)).returning();

  await recordAuditTrail(req.db!, { entityType: "Rma", entityId: withNumber!.id, action: "create", changes: req.body, performedBy: req.user?.id });
  res.status(201).json(withNumber);
});

export const getRmaHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadRma(req, Number(req.params.id));
  const [supplier] = await req.db!.select().from(suppliers).where(eq(suppliers.id, record.supplierId));
  const linkedNcr = record.linkedNcrId ? (await req.db!.select().from(ncr).where(eq(ncr.id, record.linkedNcrId)))[0] : null;
  const linkedCapa = record.linkedCapaId ? (await req.db!.select().from(capa).where(eq(capa.id, record.linkedCapaId)))[0] : null;
  const items = await itemsWithContext(req, record.id);

  res.json({
    ...record,
    supplier: supplier ? { id: supplier.id, name: supplier.name, contactEmail: supplier.contactEmail, status: supplier.status } : null,
    // Read-only summaries — see the RMA spec's NCR/CAPA Integration section.
    linkedNcr: linkedNcr ? { id: linkedNcr.id, title: linkedNcr.title, status: linkedNcr.status, severity: linkedNcr.severity } : null,
    linkedCapa: linkedCapa ? { id: linkedCapa.id, status: linkedCapa.status, rootCause: linkedCapa.rootCause } : null,
    items,
  });
});

export const updateRmaHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadRma(req, Number(req.params.id));
  const role = req.user?.roleName;
  const department = req.user?.department;
  const isQuality = role !== "admin" && department === "quality";

  if (isQuality) {
    const disallowed = Object.keys(req.body).filter((k) => !QUALITY_EDITABLE_FIELDS.includes(k));
    if (disallowed.length > 0) {
      throw AppError.forbidden(`Quality may only update ${QUALITY_EDITABLE_FIELDS.join(", ")} on an RMA (not: ${disallowed.join(", ")})`);
    }
  } else {
    assertDepartment(req, ["purchasing", "material_management"]);
  }

  const { supplierId, reasonCode } = req.body as { supplierId?: number; reasonCode?: string };
  if ((supplierId !== undefined || reasonCode !== undefined) && record.status !== "draft") {
    throw AppError.badRequest(`Cannot change supplier/reason code — RMA is "${record.status}", not "draft"`);
  }

  const [updated] = await req
    .db!.update(rma)
    .set({ ...req.body, updatedAt: new Date() })
    .where(eq(rma.id, record.id))
    .returning();
  await recordAuditTrail(req.db!, { entityType: "Rma", entityId: record.id, action: "update", changes: req.body, performedBy: req.user?.id });
  res.json(updated);
});

export const changeRmaStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadRma(req, Number(req.params.id));
  const { status: newStatus } = req.body as { status: string };

  if (!ALLOWED_NEXT[record.status]?.includes(newStatus)) {
    throw AppError.badRequest(`Cannot move an RMA from "${record.status}" to "${newStatus}"`);
  }
  if (!isAdmin(req)) assertDepartment(req, STATUS_TRANSITION_DEPARTMENTS[newStatus] ?? []);

  const patch: Record<string, unknown> = { status: newStatus, updatedAt: new Date() };
  // Records which internal user recorded the supplier's approval — there's
  // no supplier portal, so this is always a real AccuQual user relaying what
  // the supplier said, never the supplier acting directly.
  if (newStatus === "approved_by_supplier") patch.approvedByUserId = req.user?.id;

  const [updated] = await req.db!.update(rma).set(patch).where(eq(rma.id, record.id)).returning();
  await recordAuditTrail(req.db!, {
    entityType: "Rma",
    entityId: record.id,
    action: "status_change",
    changes: { oldStatus: record.status, newStatus, userId: req.user?.id },
    performedBy: req.user?.id,
  });
  // Opt-in only: lets a company build automation on RMA events in the existing
  // Workflow Builder, exactly like supplier/inventory/erp already allow for
  // themselves — not a change to any workflow outside this module.
  await publishEvent(WORKFLOW_STREAM, { module: "rma", event: newStatus, entityId: record.id });

  res.json(updated);
});

export const listRmaItemsHandler = asyncHandler(async (req: Request, res: Response) => {
  await loadRma(req, Number(req.params.id));
  res.json(await itemsWithContext(req, Number(req.params.id)));
});

export const createRmaItemHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadRma(req, Number(req.params.id));
  assertDepartment(req, ["purchasing", "material_management"]);

  const [created] = await req
    .db!.insert(rmaItems)
    .values({ ...req.body, rmaId: record.id, })
    .returning();
  await recordAuditTrail(req.db!, { entityType: "Rma", entityId: record.id, action: "update", changes: { addedItem: created }, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const updateRmaItemHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadRma(req, Number(req.params.id));
  assertDepartment(req, ["purchasing", "material_management"]);
  const itemId = Number(req.params.itemId);

  const [updated] = await req
    .db!.update(rmaItems)
    .set({ ...req.body, updatedAt: new Date() })
    .where(and(eq(rmaItems.id, itemId), eq(rmaItems.rmaId, record.id)))
    .returning();
  if (!updated) throw AppError.notFound("RmaItem");
  await recordAuditTrail(req.db!, { entityType: "Rma", entityId: record.id, action: "update", changes: { updatedItemId: itemId, ...req.body }, performedBy: req.user?.id });
  res.json(updated);
});
