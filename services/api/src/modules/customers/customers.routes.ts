import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createCustomerSchema, updateCustomerSchema, addCustomerScorecardSchema } from "./customers.validation.js";
import {
  listCustomersHandler,
  createCustomerHandler,
  getCustomerHandler,
  updateCustomerHandler,
  submitCustomerHandler,
  reviewCustomerHandler,
  approveCustomerHandler,
  rejectCustomerHandler,
  activateCustomerHandler,
  deleteCustomerHandler,
  addCustomerScorecardHandler,
  listCustomerScorecardsHandler,
  customerScorecardSummaryHandler,
} from "./customers.controller.js";

export const customersRouter = Router();
// sales_and_marketing gets "edit" (owns the whole onboarding case, same as
// its own sales_accounts pipeline); quality/engineering get "read" — see
// departmentAccess.ts PERMISSION_MATRIX.customers. Delete is admin-only, no
// department at all, enforced inline in customers.controller.ts's assertAdmin.
customersRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("customers"));

customersRouter.get("/", listCustomersHandler);
customersRouter.post("/", validate(createCustomerSchema), createCustomerHandler);
customersRouter.get("/:id", getCustomerHandler);
customersRouter.put("/:id", validate(updateCustomerSchema), updateCustomerHandler);
customersRouter.delete("/:id", deleteCustomerHandler);

// Customer Scorecard — same shape as suppliers' own manually-entered
// scorecard (see supplier.routes.ts), directly on this router since
// customers (unlike suppliers) have no separate external portal needing
// its own read mirror.
customersRouter.get("/:id/scorecard", listCustomerScorecardsHandler);
customersRouter.post("/:id/scorecard", validate(addCustomerScorecardSchema), addCustomerScorecardHandler);
customersRouter.get("/:id/scorecard-summary", customerScorecardSummaryHandler);

customersRouter.post("/:id/submit", submitCustomerHandler);
customersRouter.post("/:id/review", reviewCustomerHandler);
customersRouter.post("/:id/approve", approveCustomerHandler);
customersRouter.post("/:id/reject", rejectCustomerHandler);
customersRouter.post("/:id/activate", activateCustomerHandler);
