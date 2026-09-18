import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { validate } from "../../middleware/validate.js";
import { createChangeSchema, updateChangeSchema } from "./change.validation.js";
import { baseHandlers, approveHandler } from "./change.controller.js";

export const changeRouter = Router();
// Was completely ungated before this — Full-System Audit finding C1.
// Engineering/Quality get edit, everyone else read — see
// defaultPermissions.ts's own comment on this module's entry.
changeRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("change"));

changeRouter.get("/", baseHandlers.list);
changeRouter.post("/", validate(createChangeSchema), baseHandlers.create);
changeRouter.get("/:id", baseHandlers.getOne);
changeRouter.patch("/:id", validate(updateChangeSchema), baseHandlers.update);
changeRouter.post("/:id/approve", approveHandler);
