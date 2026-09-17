import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { baseHandlers } from "./customerCommunications.controller.js";
import { createCommunicationSchema, updateCommunicationSchema } from "./customerCommunications.validation.js";

export const customerCommunicationsRouter = Router();
// Customer Service/Quality: edit. Every other department: read. See
// defaultPermissions.ts's own comment on this module's entry.
customerCommunicationsRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("customer_communications"));

customerCommunicationsRouter.get("/", baseHandlers.list);
customerCommunicationsRouter.post("/", validate(createCommunicationSchema), baseHandlers.create);
customerCommunicationsRouter.get("/:id", baseHandlers.getOne);
customerCommunicationsRouter.patch("/:id", validate(updateCommunicationSchema), baseHandlers.update);
customerCommunicationsRouter.delete("/:id", baseHandlers.remove);
