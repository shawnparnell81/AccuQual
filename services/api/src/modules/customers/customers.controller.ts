import type { Request, Response } from "express";
import { and, eq, desc } from "drizzle-orm";
import { customers } from "../../drizzle/schema/customers.js";
import { customerScorecards } from "../../drizzle/schema/customerScorecards.js";
import { warrantyClaims } from "../../drizzle/schema/warranty.js";
import { crarClaims } from "../../drizzle/schema/crar.js";
import { feasibilityReviews } from "../../drizzle/schema/feasibility.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { stripClientOwnedFields } from "../../utils/crudFactory.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";

/** Same inline-guard style as risk/feasibility/sales.controller.ts's assertDepartment. */
function assertDepartment(req: Request, allowed: string[]) {
  const role = req.user?.roleName;
  if (role === "admin" || role === "platform_admin") return;
  const department = req.user?.department;
  if (!department || !allowed.includes(department)) {
    throw AppError.forbidden(`This action requires department: ${allowed.join(" or ")}`);
  }
}

/** Delete stays admin-only — no department gets it, same stricter rule as sales.controller.ts's assertAdmin. */
function assertAdmin(req: Request) {
  const role = req.user?.roleName;
  if (role !== "admin" && role !== "platform_admin") throw AppError.forbidden("Only an admin can delete a customer onboarding case.");
}

async function loadCustomer(req: Request, id: number) {
  const [row] = await req.db!.select().from(customers).where(and(eq(customers.id, id)));
  if (!row) throw AppError.notFound("Customer");
  return row;
}

export const listCustomersHandler = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.query as Record<string, string | undefined>;
  const conditions = [];
  if (status) conditions.push(eq(customers.status, status));
  const rows = await req.db!.select().from(customers).where(and(...conditions)).orderBy(desc(customers.createdAt));
  res.json(rows);
});

export const createCustomerHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["sales_and_marketing"]);
  const [created] = await req.db!.insert(customers).values({ ...req.body, createdBy: req.user?.id }).returning();
  await recordAuditTrail(req.db!, { entityType: "Customer", entityId: created!.id, action: "create", changes: req.body, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const getCustomerHandler = asyncHandler(async (req: Request, res: Response) => {
  const customer = await loadCustomer(req, Number(req.params.id));
  res.json(customer);
});

/**
 * POST /customers/:id/scorecard — mirrors supplier.controller.ts's own
 * addScorecardHandler exactly (overall = average of the two input scores).
 * Gated the same way every other write on this module already is:
 * sales_and_marketing (or admin), the department this router's own base
 * requireDepartmentAccess("customers") gate already grants edit to.
 */
export const addCustomerScorecardHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["sales_and_marketing"]);
  const customer = await loadCustomer(req, Number(req.params.id));

  const { qualityScore = 0, deliveryScore = 0 } = req.body;
  const overallScore = (Number(qualityScore) + Number(deliveryScore)) / 2;

  const [scorecard] = await req
    .db!.insert(customerScorecards)
    .values({ ...req.body, customerId: customer.id, overallScore: String(overallScore) })
    .returning();
  await recordAuditTrail(req.db!, { entityType: "CustomerScorecard", entityId: scorecard!.id, action: "create", changes: req.body, performedBy: req.user?.id });
  res.status(201).json(scorecard);
});

/** GET /customers/:id/scorecard — the manually-entered history, newest first. Read-level (quality/engineering too), same as every other GET here. */
export const listCustomerScorecardsHandler = asyncHandler(async (req: Request, res: Response) => {
  const customer = await loadCustomer(req, Number(req.params.id));
  const rows = await req.db!
    .select()
    .from(customerScorecards)
    .where(and(eq(customerScorecards.customerId, customer.id)))
    .orderBy(desc(customerScorecards.createdAt));
  res.json(rows);
});

/**
 * GET /customers/:id/scorecard-summary — real counts from the three
 * modules that actually carry a customerId FK today (see
 * customerScorecards.ts's own comment on why this stays honest counts
 * instead of a weighted risk score like suppliers get).
 */
export const customerScorecardSummaryHandler = asyncHandler(async (req: Request, res: Response) => {
  const customer = await loadCustomer(req, Number(req.params.id));
  const [warranty, crar, feasibility] = await Promise.all([
    req.db!.select({ id: warrantyClaims.id }).from(warrantyClaims).where(and(eq(warrantyClaims.customerId, customer.id))),
    req.db!.select({ id: crarClaims.id }).from(crarClaims).where(and(eq(crarClaims.customerId, customer.id))),
    req.db!.select({ id: feasibilityReviews.id }).from(feasibilityReviews).where(and(eq(feasibilityReviews.customerId, customer.id))),
  ]);
  res.json({ warrantyClaimCount: warranty.length, crarCount: crar.length, feasibilityReviewCount: feasibility.length });
});

export const updateCustomerHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["sales_and_marketing"]);
  const customer = await loadCustomer(req, Number(req.params.id));
  const { aiSuggested, ...rest } = req.body as { aiSuggested?: boolean } & Record<string, unknown>;
  const body = stripClientOwnedFields(rest);
  const [updated] = await req.db!.update(customers).set({ ...body, updatedAt: new Date() }).where(eq(customers.id, customer.id)).returning();
  await recordAuditTrail(req.db!, {
    entityType: "Customer",
    entityId: customer.id,
    action: "update",
    changes: aiSuggested ? { subAction: "ai_suggestion_accepted", ...body } : body,
    performedBy: req.user?.id,
  });
  res.json(updated);
});

// draft -> submitted -> under_review -> approved -> activated
//                                     \-> rejected
const CUSTOMER_NEXT: Record<string, string[]> = {
  draft: ["submitted"],
  submitted: ["under_review"],
  under_review: ["approved", "rejected"],
  approved: ["activated"],
};

async function transitionCustomer(req: Request, id: number, newStatus: string) {
  const customer = await loadCustomer(req, id);
  if (!CUSTOMER_NEXT[customer.status]?.includes(newStatus)) throw AppError.badRequest(`Cannot move a customer from "${customer.status}" to "${newStatus}".`);
  const timestamps: Record<string, Date> = {};
  if (newStatus === "approved" || newStatus === "rejected") timestamps.decidedAt = new Date();
  if (newStatus === "activated") timestamps.activatedAt = new Date();
  const [updated] = await req.db!
    .update(customers)
    .set({ status: newStatus, updatedAt: new Date(), ...timestamps })
    .where(eq(customers.id, id))
    .returning();
  await recordAuditTrail(req.db!, { entityType: "Customer", entityId: id, action: "status_change", changes: { oldStatus: customer.status, newStatus }, performedBy: req.user?.id });
  await publishEvent(WORKFLOW_STREAM, { module: "customers", event: newStatus, entityId: id });
  return updated!;
}

export const submitCustomerHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["sales_and_marketing"]);
  res.json(await transitionCustomer(req, Number(req.params.id), "submitted"));
});
export const reviewCustomerHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["sales_and_marketing"]);
  res.json(await transitionCustomer(req, Number(req.params.id), "under_review"));
});
export const approveCustomerHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["sales_and_marketing"]);
  res.json(await transitionCustomer(req, Number(req.params.id), "approved"));
});
export const rejectCustomerHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["sales_and_marketing"]);
  res.json(await transitionCustomer(req, Number(req.params.id), "rejected"));
});
export const activateCustomerHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["sales_and_marketing"]);
  res.json(await transitionCustomer(req, Number(req.params.id), "activated"));
});

export const deleteCustomerHandler = asyncHandler(async (req: Request, res: Response) => {
  assertAdmin(req);
  const customer = await loadCustomer(req, Number(req.params.id));
  await req.db!.delete(customers).where(and(eq(customers.id, customer.id)));
  await recordAuditTrail(req.db!, { entityType: "Customer", entityId: customer.id, action: "delete", changes: { legalName: customer.legalName }, performedBy: req.user?.id });
  res.status(204).send();
});
