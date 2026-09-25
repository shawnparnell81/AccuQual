import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createAccountSchema, updateAccountSchema, createActivitySchema, createQuoteSchema, updateQuoteSchema, createContractSchema, updateContractSchema } from "./sales.validation.js";
import {
  listAccountsHandler,
  createAccountHandler,
  getAccountHandler,
  updateAccountHandler,
  activateAccountHandler,
  markDormantAccountHandler,
  deleteAccountHandler,
  createActivityHandler,
  createQuoteHandler,
  updateQuoteHandler,
  submitQuoteHandler,
  acceptQuoteHandler,
  rejectQuoteHandler,
  archiveQuoteHandler,
  createContractHandler,
  updateContractHandler,
  activateContractHandler,
  expireContractHandler,
  archiveContractHandler,
} from "./sales.controller.js";

export const salesRouter = Router();
// sales_and_marketing gets "edit" (create/edit everything in this module);
// quality/engineering get "read" (they review customer-requirements-linked
// documents through the existing Document Control approval flow, not this
// module's own gate) — see departmentAccess.ts PERMISSION_MATRIX.sales.
// Per-action gating (delete is admin-only, no department at all) is inline
// in sales.controller.ts's assertDepartment/assertAdmin, same pattern as
// risk/feasibility.
salesRouter.use(requireAuth, withDb, requireDepartmentAccess("sales"));

salesRouter.get("/accounts", listAccountsHandler);
salesRouter.post("/accounts", validate(createAccountSchema), createAccountHandler);
salesRouter.get("/accounts/:id", getAccountHandler);
salesRouter.put("/accounts/:id", validate(updateAccountSchema), updateAccountHandler);
salesRouter.delete("/accounts/:id", deleteAccountHandler);
salesRouter.post("/accounts/:id/activate", activateAccountHandler);
salesRouter.post("/accounts/:id/mark-dormant", markDormantAccountHandler);

salesRouter.post("/accounts/:id/activities", validate(createActivitySchema), createActivityHandler);

salesRouter.post("/accounts/:id/quotes", validate(createQuoteSchema), createQuoteHandler);
salesRouter.put("/accounts/:id/quotes/:qid", validate(updateQuoteSchema), updateQuoteHandler);
salesRouter.post("/accounts/:id/quotes/:qid/submit", submitQuoteHandler);
salesRouter.post("/accounts/:id/quotes/:qid/accept", acceptQuoteHandler);
salesRouter.post("/accounts/:id/quotes/:qid/reject", rejectQuoteHandler);
salesRouter.post("/accounts/:id/quotes/:qid/archive", archiveQuoteHandler);

salesRouter.post("/accounts/:id/contracts", validate(createContractSchema), createContractHandler);
salesRouter.put("/accounts/:id/contracts/:cid", validate(updateContractSchema), updateContractHandler);
salesRouter.post("/accounts/:id/contracts/:cid/activate", activateContractHandler);
salesRouter.post("/accounts/:id/contracts/:cid/expire", expireContractHandler);
salesRouter.post("/accounts/:id/contracts/:cid/archive", archiveContractHandler);
