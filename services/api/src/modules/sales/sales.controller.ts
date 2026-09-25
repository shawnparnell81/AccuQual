import type { Request, Response } from "express";
import { and, eq, desc } from "drizzle-orm";
import { salesAccounts, salesActivities, salesQuotes, salesContracts } from "../../drizzle/schema/sales.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { stripClientOwnedFields } from "../../utils/crudFactory.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";

/** Same inline-guard style as risk/feasibility.controller.ts's assertDepartment. */
function assertDepartment(req: Request, allowed: string[]) {
  const role = req.user?.roleName;
  if (role === "admin") return;
  const department = req.user?.department;
  if (!department || !allowed.includes(department)) {
    throw AppError.forbidden(`This action requires department: ${allowed.join(" or ")}`);
  }
}

/** Delete stays admin-only — no department gets it, per the module's own explicit "Admin: delete records" rule (unlike risk/feasibility's wider delete gate). */
function assertAdmin(req: Request) {
  const role = req.user?.roleName;
  if (role !== "admin") throw AppError.forbidden("Only an admin can delete a sales record.");
}

async function loadAccount(req: Request, id: number) {
  const [row] = await req.db!.select().from(salesAccounts).where(and(eq(salesAccounts.id, id)));
  if (!row) throw AppError.notFound("Sales account");
  return row;
}

async function loadQuote(req: Request, accountId: number, quoteId: number) {
  const [row] = await req.db!.select().from(salesQuotes).where(and(eq(salesQuotes.id, quoteId), eq(salesQuotes.accountId, accountId)));
  if (!row) throw AppError.notFound("Quote");
  return row;
}

async function loadContract(req: Request, accountId: number, contractId: number) {
  const [row] = await req.db!.select().from(salesContracts).where(and(eq(salesContracts.id, contractId), eq(salesContracts.accountId, accountId)));
  if (!row) throw AppError.notFound("Contract");
  return row;
}

// ---------------- Accounts ----------------

export const listAccountsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.query as Record<string, string | undefined>;
  const conditions = [];
  if (status) conditions.push(eq(salesAccounts.status, status));
  const rows = await req.db!.select().from(salesAccounts).where(and(...conditions)).orderBy(desc(salesAccounts.createdAt));
  res.json(rows);
});

export const createAccountHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["sales_and_marketing"]);
  const [created] = await req.db!.insert(salesAccounts).values({ ...req.body, createdBy: req.user?.id }).returning();
  await recordAuditTrail(req.db!, { entityType: "SalesAccount", entityId: created!.id, action: "create", changes: req.body, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const getAccountHandler = asyncHandler(async (req: Request, res: Response) => {
  const account = await loadAccount(req, Number(req.params.id));
  const activities = await req.db!.select().from(salesActivities).where(and(eq(salesActivities.accountId, account.id))).orderBy(desc(salesActivities.createdAt));
  const quotes = await req.db!.select().from(salesQuotes).where(and(eq(salesQuotes.accountId, account.id))).orderBy(desc(salesQuotes.createdAt));
  const contracts = await req.db!.select().from(salesContracts).where(and(eq(salesContracts.accountId, account.id))).orderBy(desc(salesContracts.createdAt));
  res.json({ ...account, activities, quotes, contracts });
});

export const updateAccountHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["sales_and_marketing"]);
  const account = await loadAccount(req, Number(req.params.id));
  const { aiSuggested, ...rest } = req.body as { aiSuggested?: boolean } & Record<string, unknown>;
  const body = stripClientOwnedFields(rest);
  const [updated] = await req.db!.update(salesAccounts).set({ ...body, updatedAt: new Date() }).where(eq(salesAccounts.id, account.id)).returning();
  await recordAuditTrail(req.db!, {
    entityType: "SalesAccount",
    entityId: account.id,
    action: "update",
    changes: aiSuggested ? { subAction: "ai_suggestion_accepted", ...body } : body,
    performedBy: req.user?.id,
  });
  res.json(updated);
});

const ACCOUNT_NEXT: Record<string, string> = { prospect: "active", active: "dormant" };

async function transitionAccount(req: Request, id: number, newStatus: string) {
  const account = await loadAccount(req, id);
  if (ACCOUNT_NEXT[account.status] !== newStatus) throw AppError.badRequest(`Cannot move an account from "${account.status}" to "${newStatus}".`);
  const [updated] = await req.db!.update(salesAccounts).set({ status: newStatus, updatedAt: new Date() }).where(eq(salesAccounts.id, id)).returning();
  await recordAuditTrail(req.db!, { entityType: "SalesAccount", entityId: id, action: "status_change", changes: { oldStatus: account.status, newStatus }, performedBy: req.user?.id });
  await publishEvent(WORKFLOW_STREAM, { module: "sales_accounts", event: newStatus, entityId: id });
  return updated!;
}

export const activateAccountHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["sales_and_marketing"]);
  res.json(await transitionAccount(req, Number(req.params.id), "active"));
});

export const markDormantAccountHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["sales_and_marketing"]);
  res.json(await transitionAccount(req, Number(req.params.id), "dormant"));
});

export const deleteAccountHandler = asyncHandler(async (req: Request, res: Response) => {
  assertAdmin(req);
  const account = await loadAccount(req, Number(req.params.id));
  await req.db!.delete(salesActivities).where(and(eq(salesActivities.accountId, account.id)));
  await req.db!.delete(salesQuotes).where(and(eq(salesQuotes.accountId, account.id)));
  await req.db!.delete(salesContracts).where(and(eq(salesContracts.accountId, account.id)));
  await req.db!.delete(salesAccounts).where(and(eq(salesAccounts.id, account.id)));
  await recordAuditTrail(req.db!, { entityType: "SalesAccount", entityId: account.id, action: "delete", changes: { customerName: account.customerName }, performedBy: req.user?.id });
  res.status(204).send();
});

// ---------------- Activities (append-only — no update/delete, a real CRM note log) ----------------

/**
 * Also how the "Link to Sales Account" button on NCR/PPAP/Change Management/
 * Work Orders/Requisitions/PO/RMA works — those pages call this same
 * endpoint with relatedSourceType/relatedSourceId set, giving the account a
 * real, visible cross-module trail instead of a bespoke join table.
 */
export const createActivityHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["sales_and_marketing"]);
  const account = await loadAccount(req, Number(req.params.id));
  const [created] = await req.db!.insert(salesActivities).values({ ...req.body, accountId: account.id, createdBy: req.user?.id }).returning();
  await recordAuditTrail(req.db!, { entityType: "SalesAccount", entityId: account.id, action: "update", changes: { subAction: "activity_added", ...req.body }, performedBy: req.user?.id });
  res.status(201).json(created);
});

// ---------------- Quotes ----------------

export const createQuoteHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["sales_and_marketing"]);
  const account = await loadAccount(req, Number(req.params.id));
  // quoteNumber is NOT NULL (see sales.ts's schema) — a placeholder, real
  // value written right after, same as RMA's rmaNumber (rma.controller.ts).
  const [created] = await req.db!
    .insert(salesQuotes)
    .values({ quoteNumber: `PENDING-${Date.now()}`, ...req.body, accountId: account.id, createdBy: req.user?.id })
    .returning();
  const final = req.body.quoteNumber ? created! : (await req.db!.update(salesQuotes).set({ quoteNumber: `Q-${created!.id}` }).where(eq(salesQuotes.id, created!.id)).returning())[0]!;
  await recordAuditTrail(req.db!, { entityType: "SalesQuote", entityId: final.id, action: "create", changes: req.body, performedBy: req.user?.id });
  res.status(201).json(final);
});

export const updateQuoteHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["sales_and_marketing"]);
  const accountId = Number(req.params.id);
  const quote = await loadQuote(req, accountId, Number(req.params.qid));
  if (quote.status !== "draft") throw AppError.badRequest(`Cannot edit a quote that is "${quote.status}", not "draft".`);
  const body = stripClientOwnedFields(req.body);
  const [updated] = await req.db!.update(salesQuotes).set({ ...body, updatedAt: new Date() }).where(eq(salesQuotes.id, quote.id)).returning();
  await recordAuditTrail(req.db!, { entityType: "SalesQuote", entityId: quote.id, action: "update", changes: body, performedBy: req.user?.id });
  res.json(updated);
});

const QUOTE_NEXT: Record<string, string[]> = { draft: ["submitted"], submitted: ["accepted", "rejected"], accepted: ["archived"] };

async function transitionQuote(req: Request, accountId: number, quoteId: number, newStatus: string) {
  const quote = await loadQuote(req, accountId, quoteId);
  if (!QUOTE_NEXT[quote.status]?.includes(newStatus)) throw AppError.badRequest(`Cannot move a quote from "${quote.status}" to "${newStatus}".`);
  const [updated] = await req.db!.update(salesQuotes).set({ status: newStatus, updatedAt: new Date() }).where(eq(salesQuotes.id, quoteId)).returning();
  await recordAuditTrail(req.db!, { entityType: "SalesQuote", entityId: quoteId, action: "status_change", changes: { oldStatus: quote.status, newStatus }, performedBy: req.user?.id });
  return updated!;
}

export const submitQuoteHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["sales_and_marketing"]);
  res.json(await transitionQuote(req, Number(req.params.id), Number(req.params.qid), "submitted"));
});
export const acceptQuoteHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["sales_and_marketing"]);
  res.json(await transitionQuote(req, Number(req.params.id), Number(req.params.qid), "accepted"));
});
export const rejectQuoteHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["sales_and_marketing"]);
  res.json(await transitionQuote(req, Number(req.params.id), Number(req.params.qid), "rejected"));
});
export const archiveQuoteHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["sales_and_marketing"]);
  res.json(await transitionQuote(req, Number(req.params.id), Number(req.params.qid), "archived"));
});

// ---------------- Contracts ----------------

export const createContractHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["sales_and_marketing"]);
  const account = await loadAccount(req, Number(req.params.id));
  const [created] = await req.db!.insert(salesContracts).values({ ...req.body, accountId: account.id, createdBy: req.user?.id }).returning();
  await recordAuditTrail(req.db!, { entityType: "SalesContract", entityId: created!.id, action: "create", changes: req.body, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const updateContractHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["sales_and_marketing"]);
  const accountId = Number(req.params.id);
  const contract = await loadContract(req, accountId, Number(req.params.cid));
  if (contract.status !== "draft") throw AppError.badRequest(`Cannot edit a contract that is "${contract.status}", not "draft".`);
  const body = stripClientOwnedFields(req.body);
  const [updated] = await req.db!.update(salesContracts).set({ ...body, updatedAt: new Date() }).where(eq(salesContracts.id, contract.id)).returning();
  await recordAuditTrail(req.db!, { entityType: "SalesContract", entityId: contract.id, action: "update", changes: body, performedBy: req.user?.id });
  res.json(updated);
});

const CONTRACT_NEXT: Record<string, string> = { draft: "active", active: "expired", expired: "archived" };

async function transitionContract(req: Request, accountId: number, contractId: number, newStatus: string) {
  const contract = await loadContract(req, accountId, contractId);
  if (CONTRACT_NEXT[contract.status] !== newStatus) throw AppError.badRequest(`Cannot move a contract from "${contract.status}" to "${newStatus}".`);
  const [updated] = await req.db!.update(salesContracts).set({ status: newStatus, updatedAt: new Date() }).where(eq(salesContracts.id, contractId)).returning();
  await recordAuditTrail(req.db!, { entityType: "SalesContract", entityId: contractId, action: "status_change", changes: { oldStatus: contract.status, newStatus }, performedBy: req.user?.id });
  return updated!;
}

export const activateContractHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["sales_and_marketing"]);
  res.json(await transitionContract(req, Number(req.params.id), Number(req.params.cid), "active"));
});
export const expireContractHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["sales_and_marketing"]);
  res.json(await transitionContract(req, Number(req.params.id), Number(req.params.cid), "expired"));
});
export const archiveContractHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["sales_and_marketing"]);
  res.json(await transitionContract(req, Number(req.params.id), Number(req.params.cid), "archived"));
});
