import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { updateBrandingSchema, updateAiConfigSchema } from "./tenant.validation.js";
import { getBrandingHandler, updateBrandingHandler, getAiConfigHandler, updateAiConfigHandler } from "./tenant.controller.js";

/** A tenant admin's own settings — scoped to req.tenantId, never a foreign tenant id. Admin-only (requireRole), not department-gated: branding/AI config aren't a department concern. */
export const tenantRouter = Router();
tenantRouter.use(requireAuth, withTenantDb);

tenantRouter.get("/branding", getBrandingHandler);
tenantRouter.patch("/branding", requireRole("admin"), validate(updateBrandingSchema), updateBrandingHandler);

tenantRouter.get("/ai-config", requireRole("admin"), getAiConfigHandler);
tenantRouter.patch("/ai-config", requireRole("admin"), validate(updateAiConfigSchema), updateAiConfigHandler);
