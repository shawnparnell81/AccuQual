import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createEightDSchema, updateEightDSchema, completeStepSchema } from "./eight-d.validation.js";
import { baseHandlers, completeStepHandler } from "./eight-d.controller.js";

export const eightDRouter = Router();
// Phase 3 RBAC verification fix: this router had no requireDepartmentAccess
// gate at all despite "eight_d" being a real, seeded ResourceKey
// (quality: edit in defaultPermissions.ts) — any authenticated user of any
// department could read/write every 8D report. Every sibling module
// (ncr, capa, crar, warranty, ...) applies this same gate at the router
// level; this was a real gap, not a deliberate exception.
eightDRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("eight_d"));

eightDRouter.get("/", baseHandlers.list);
eightDRouter.post("/", validate(createEightDSchema), baseHandlers.create);
eightDRouter.get("/:id", baseHandlers.getOne);
eightDRouter.patch("/:id", validate(updateEightDSchema), baseHandlers.update);
eightDRouter.post("/:id/complete-step/:step", validate(completeStepSchema), completeStepHandler);
