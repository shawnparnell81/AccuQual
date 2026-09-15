import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createCustomerSchema, updateCustomerSchema } from "./customers.validation.js";
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

customersRouter.post("/:id/submit", submitCustomerHandler);
customersRouter.post("/:id/review", reviewCustomerHandler);
customersRouter.post("/:id/approve", approveCustomerHandler);
customersRouter.post("/:id/reject", rejectCustomerHandler);
customersRouter.post("/:id/activate", activateCustomerHandler);
