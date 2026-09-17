import type { Request, Response } from "express";
import { and, eq, ilike, desc, type SQL } from "drizzle-orm";
import { crarClaims } from "../../drizzle/schema/crar.js";
import { warrantyClaims } from "../../drizzle/schema/warranty.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { rma } from "../../drizzle/schema/rma.js";
import { supplierRmaRequests } from "../../drizzle/schema/supplierRma.js";
import { rmaLogRecords } from "../../drizzle/schema/rmaLog.js";
import { customers } from "../../drizzle/schema/customers.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail, recordAuditTrailStandalone } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import { getUserAccessLevel } from "../../middleware/departmentAccess.js";
import { pool } from "../../db/index.js";
import type { TenantDb } from "../../lib/tenantScope.js";

/** Same inline-guard style as rma.controller.ts/warranty.controller.ts's assertDepartment — used for the one thing left that genuinely IS a fixed business rule rather than a tunable access level (which stage of the workflow belongs to whom — see STATUS_TRANSITION_DEPARTMENTS below). */
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
 * Module-specific RBAC build (2026-09-16): create/full-content-edit used to
 * be hardcoded to `assertDepartment(req, ["quality"])`, bypassing whatever
 * the Roles & Permissions module's own "crar" access level actually said
 * for any OTHER department. Now it's the real, live check — any department
 * with "edit" on crar (self-service configurable, department_permissions
 * or a custom role) may fully create/edit a CRAR's content, EXCEPT the
 * warranty-link-only departments below, whose narrower carve-out is a real
 * structural business rule (not a tunable level) and stays hardcoded, same
 * as it always has. Default behavior is bit-for-bit unchanged (today only
 * quality has crar edit AND isn't link-only) — the new capability is
 * purely additive: grant e.g. sales_and_marketing "edit" on crar via the
 * admin UI and they gain full create/edit rights too, without touching
 * this function.
 */
async function assertCrarContentWrite(req: Request) {
  if (isAdmin(req)) return;
  const department = req.user?.department;
  if (department && WARRANTY_LINK_ONLY_DEPARTMENTS.includes(department)) {
    throw AppError.forbidden("Your department may only link a CRAR to a warranty claim, not edit its content");
  }
  const level = await getUserAccessLevel(req.db! as TenantDb, req.tenantId!, req.user!, "crar");
  if (level !== "edit") {
    throw AppError.forbidden("This action requires edit access to CRAR (crar.write)");
  }
}

/** A fixed, linear lifecycle exactly as specified — no branching, unlike Warranty's own approve/reject fork. completed is terminal. */
const ALLOWED_NEXT: Record<string, string[]> = {
  new: ["quality_review"],
  quality_review: ["warranty_review"],
  warranty_review: ["completed"],
  completed: [],
};

/**
 * quality_review/warranty_review are both Quality's own hand-offs (Quality
 * owns the review end to end, per the brief's "Quality: Full access to
 * CRAR"); completed is the one stage engineering/purchasing may also move
 * — AccuQual has no literal "Warranty" department (see
 * departmentAccess.ts's PERMISSION_MATRIX.crar comment), so "Warranty can
 * finish its review" is expressed here as the real departments that DO
 * edit the Warranty module itself finishing this one stage.
 */
const STATUS_TRANSITION_DEPARTMENTS: Record<string, string[]> = {
  quality_review: ["quality"],
  warranty_review: ["quality"],
  completed: ["quality", "engineering", "purchasing"],
};

/**
 * Engineering/purchasing hold "edit" in PERMISSION_MATRIX.crar only so the
 * link-to-warranty-claim action (a PATCH) isn't blocked at the router —
 * see departmentAccess.ts's own comment. Inline here, they may ONLY ever
 * touch `warrantyId` on an existing record, never the report's own 54
 * content fields, never create one.
 */
const WARRANTY_LINK_ONLY_DEPARTMENTS = ["engineering", "purchasing"];
const WARRANTY_LINK_FIELDS = ["warrantyId"];

async function loadCrar(req: Request, id: number) {
  const [row] = await req.db!.select().from(crarClaims).where(and(eq(crarClaims.id, id), eq(crarClaims.tenantId, req.tenantId!)));
  if (!row) throw AppError.notFound("Crar");
  return row;
}

export const listCrarHandler = asyncHandler(async (req: Request, res: Response) => {
  const { status, warrantyId, q } = req.query as Record<string, string | undefined>;
  const conditions: SQL[] = [eq(crarClaims.tenantId, req.tenantId!)];
  if (status) conditions.push(eq(crarClaims.status, status));
  if (warrantyId) conditions.push(eq(crarClaims.warrantyId, Number(warrantyId)));
  if (q) conditions.push(ilike(crarClaims.customerClaim, `%${q}%`));

  const rows = await req
    .db!.select({
      id: crarClaims.id,
      status: crarClaims.status,
      customerName: crarClaims.customerName,
      rmaNumber: crarClaims.rmaNumber,
      customerClaim: crarClaims.customerClaim,
      partNumber: crarClaims.partNumber,
      warrantyId: crarClaims.warrantyId,
      reportDate: crarClaims.reportDate,
      createdAt: crarClaims.createdAt,
      updatedAt: crarClaims.updatedAt,
    })
    .from(crarClaims)
    .where(and(...conditions))
    .orderBy(desc(crarClaims.createdAt));
  res.json(rows);
});

export const createCrarHandler = asyncHandler(async (req: Request, res: Response) => {
  // Quality initiates a CRAR by default — matches the brief's own
  // "Integrated with Quality Department" as the primary owner. Now a live
  // DB check (crar.write) rather than hardcoded to quality alone — see
  // assertCrarContentWrite's own comment.
  await assertCrarContentWrite(req);
  const body = req.body as Record<string, unknown>;

  if (body.warrantyId !== undefined && body.warrantyId !== null) {
    const [w] = await req.db!.select({ id: warrantyClaims.id }).from(warrantyClaims).where(and(eq(warrantyClaims.id, body.warrantyId as number), eq(warrantyClaims.tenantId, req.tenantId!)));
    if (!w) throw AppError.badRequest(`Warranty claim #${body.warrantyId} not found`);
  }
  if (body.qualityId !== undefined && body.qualityId !== null) {
    const [n] = await req.db!.select({ id: ncr.id }).from(ncr).where(and(eq(ncr.id, body.qualityId as number), eq(ncr.tenantId, req.tenantId!)));
    if (!n) throw AppError.badRequest(`NCR #${body.qualityId} not found`);
  }
  if (body.supplierRmaRequestId !== undefined && body.supplierRmaRequestId !== null) {
    const [s] = await req.db!.select({ id: supplierRmaRequests.id }).from(supplierRmaRequests).where(and(eq(supplierRmaRequests.id, body.supplierRmaRequestId as number), eq(supplierRmaRequests.tenantId, req.tenantId!)));
    if (!s) throw AppError.badRequest(`Supplier RMA Request #${body.supplierRmaRequestId} not found`);
  }
  if (body.linkedRmaId !== undefined && body.linkedRmaId !== null) {
    const [r] = await req.db!.select({ id: rma.id }).from(rma).where(and(eq(rma.id, body.linkedRmaId as number), eq(rma.tenantId, req.tenantId!)));
    if (!r) throw AppError.badRequest(`RMA #${body.linkedRmaId} not found`);
  }
  // Phase 2 fix: RMA Log link, previously entirely missing (see crar.ts's
  // own schema comment) — same existence-check style as every other link.
  if (body.rmaLogId !== undefined && body.rmaLogId !== null) {
    const [rl] = await req.db!.select({ id: rmaLogRecords.id }).from(rmaLogRecords).where(and(eq(rmaLogRecords.id, body.rmaLogId as number), eq(rmaLogRecords.tenantId, req.tenantId!)));
    if (!rl) throw AppError.badRequest(`RMA Log #${body.rmaLogId} not found`);
  }
  if (body.customerId !== undefined && body.customerId !== null) {
    const [c] = await req.db!.select({ id: customers.id }).from(customers).where(and(eq(customers.id, body.customerId as number), eq(customers.tenantId, req.tenantId!)));
    if (!c) throw AppError.badRequest(`Customer #${body.customerId} not found`);
  }

  // Phase 2 fix ("Add customer contact fields"): a CRAR usually starts from
  // an existing Warranty claim ("+Start CRAR") — inherit that claim's own
  // customer link automatically rather than making someone re-select the
  // same customer a second time, unless one was already given explicitly.
  let customerId = body.customerId as number | null | undefined;
  if (customerId === undefined && body.warrantyId) {
    const [w] = await req.db!.select({ customerId: warrantyClaims.customerId }).from(warrantyClaims).where(eq(warrantyClaims.id, body.warrantyId as number));
    customerId = w?.customerId ?? undefined;
  }

  const [created] = await req
    .db!.insert(crarClaims)
    .values({ tenantId: req.tenantId!, ...body, customerId, createdByUserId: req.user?.id })
    .returning();

  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "Crar", entityId: created!.id, action: "create", changes: req.body, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const getCrarHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadCrar(req, Number(req.params.id));
  const [warranty] = record.warrantyId ? await req.db!.select().from(warrantyClaims).where(eq(warrantyClaims.id, record.warrantyId)) : [null];
  const [linkedNcr] = record.qualityId ? await req.db!.select().from(ncr).where(eq(ncr.id, record.qualityId)) : [null];
  const [supplierRequest] = record.supplierRmaRequestId ? await req.db!.select().from(supplierRmaRequests).where(eq(supplierRmaRequests.id, record.supplierRmaRequestId)) : [null];
  const [linkedRma] = record.linkedRmaId ? await req.db!.select().from(rma).where(eq(rma.id, record.linkedRmaId)) : [null];
  // Phase 2 fixes: RMA Log link + customer contact, both previously missing.
  const [linkedRmaLog] = record.rmaLogId ? await req.db!.select().from(rmaLogRecords).where(eq(rmaLogRecords.id, record.rmaLogId)) : [null];
  const [customer] = record.customerId ? await req.db!.select().from(customers).where(eq(customers.id, record.customerId)) : [null];

  res.json({
    ...record,
    warranty: warranty ? { id: warranty.id, claimNumber: warranty.claimNumber, status: warranty.status } : null,
    linkedNcr: linkedNcr ? { id: linkedNcr.id, title: linkedNcr.title, status: linkedNcr.status } : null,
    supplierRequest: supplierRequest ? { id: supplierRequest.id, companyName: supplierRequest.companyName, status: supplierRequest.status } : null,
    linkedRma: linkedRma ? { id: linkedRma.id, rmaNumber: linkedRma.rmaNumber, status: linkedRma.status } : null,
    linkedRmaLog: linkedRmaLog ? { id: linkedRmaLog.id, rmaNumber: linkedRmaLog.rmaNumber, status: linkedRmaLog.status } : null,
    customer: customer ? { id: customer.id, legalName: customer.legalName, primaryContactEmail: customer.primaryContactEmail, primaryContactPhone: customer.primaryContactPhone } : null,
  });
});

export const updateCrarHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadCrar(req, Number(req.params.id));
  if (record.status === "completed") throw AppError.badRequest("This CRAR is completed and can no longer be edited");

  const role = req.user?.roleName;
  const department = req.user?.department;
  const isLinkOnly = role !== "admin" && role !== "platform_admin" && department != null && WARRANTY_LINK_ONLY_DEPARTMENTS.includes(department);

  if (isLinkOnly) {
    const disallowed = Object.keys(req.body).filter((k) => !WARRANTY_LINK_FIELDS.includes(k));
    if (disallowed.length > 0) {
      await recordAuditTrailStandalone(pool, {
        tenantId: req.tenantId!,
        entityType: "Crar",
        entityId: record.id,
        action: "permission_denied",
        changes: { attemptedAction: "update_content", disallowedFields: disallowed },
        performedBy: req.user?.id,
      });
      throw AppError.forbidden(`Your department may only update ${WARRANTY_LINK_FIELDS.join(", ")} on a CRAR (not: ${disallowed.join(", ")})`);
    }
  } else {
    await assertCrarContentWrite(req);
  }

  const patch: Record<string, unknown> = { ...req.body };
  if (patch.warrantyId !== undefined && patch.warrantyId !== null) {
    const [w] = await req.db!.select({ id: warrantyClaims.id, customerId: warrantyClaims.customerId }).from(warrantyClaims).where(and(eq(warrantyClaims.id, patch.warrantyId as number), eq(warrantyClaims.tenantId, req.tenantId!)));
    if (!w) throw AppError.badRequest(`Warranty claim #${patch.warrantyId} not found`);
    // Phase 2 fix: linking (or re-linking) a warranty claim later also backs
    // a customer in, same as createCrarHandler does at creation time — only
    // when this request isn't already setting customerId itself and the
    // record doesn't already have one, so it never overwrites a
    // deliberately-chosen or already-linked customer.
    if (patch.customerId === undefined && record.customerId === null && w.customerId) patch.customerId = w.customerId;
  }

  const [updated] = await req
    .db!.update(crarClaims)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(crarClaims.id, record.id))
    .returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "Crar", entityId: record.id, action: "update", changes: patch, performedBy: req.user?.id });
  res.json(updated);
});

export const transitionCrarHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadCrar(req, Number(req.params.id));
  const { status: newStatus } = req.body as { status: string };

  if (!ALLOWED_NEXT[record.status]?.includes(newStatus)) {
    throw AppError.badRequest(`Cannot move a CRAR from "${record.status}" to "${newStatus}"`);
  }
  if (!isAdmin(req)) {
    // Two independent checks, both must pass: WHICH stage belongs to whom
    // stays a real, hardcoded workflow-ownership rule (unchanged); whether
    // this department can attempt a transition AT ALL is now the module-
    // specific RBAC brief's own separate, self-service "crar.workflow.write"
    // lever (crar_workflow) layered on top — see db/defaultPermissions.ts's
    // own comment on why its seeded default matches today's real behavior
    // exactly (the union of every department in STATUS_TRANSITION_DEPARTMENTS).
    const workflowLevel = await getUserAccessLevel(req.db! as TenantDb, req.tenantId!, req.user!, "crar_workflow");
    if (workflowLevel !== "edit") {
      await recordAuditTrailStandalone(pool, {
        tenantId: req.tenantId!,
        entityType: "Crar",
        entityId: record.id,
        action: "permission_denied",
        changes: { attemptedAction: "status_change", fromStatus: record.status, toStatus: newStatus },
        performedBy: req.user?.id,
      });
      throw AppError.forbidden("Changing a CRAR's status requires the crar.workflow.write permission");
    }
    assertDepartment(req, STATUS_TRANSITION_DEPARTMENTS[newStatus] ?? []);
  }

  const [updated] = await req.db!.update(crarClaims).set({ status: newStatus, updatedAt: new Date() }).where(eq(crarClaims.id, record.id)).returning();

  // "workflow_transition" per the brief's own words maps onto this app's
  // real audit_trail action enum as "status_change" — the same category
  // every other module's transitions log under (see e.g.
  // warranty.controller.ts's own transition handler).
  await recordAuditTrail(req.db!, {
    tenantId: req.tenantId!,
    entityType: "Crar",
    entityId: record.id,
    action: "status_change",
    changes: { oldStatus: record.status, newStatus, userId: req.user?.id },
    performedBy: req.user?.id,
  });
  await publishEvent(WORKFLOW_STREAM, { tenantId: req.tenantId!, module: "crar", event: newStatus, entityId: record.id });

  res.json(updated);
});
