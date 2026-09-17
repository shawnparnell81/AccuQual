import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createPpapSchema } from "./ppap.validation.js";
import { baseHandlers } from "./ppap.controller.js";

export const ppapRouter = Router();
// Phase 3 RBAC verification fix: same gap class as eight-d.routes.ts — no
// requireDepartmentAccess gate despite "ppap" being a real, seeded
// ResourceKey (engineering: edit in defaultPermissions.ts).
ppapRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("ppap"));

ppapRouter.get("/", baseHandlers.list);
ppapRouter.post("/", validate(createPpapSchema), baseHandlers.create);
ppapRouter.get("/:id", baseHandlers.getOne);
