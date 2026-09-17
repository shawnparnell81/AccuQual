import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requirePlatformAdmin } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { createTenantSchema, updateTenantSchema } from "./platform.validation.js";
import { createTenantHandler, listTenantsHandler, updateTenantHandler, deleteTenantHandler, getAiOverviewHandler } from "./platform.controller.js";

/**
 * Platform-admin-only, cross-tenant routes (tenant provisioning/management —
 * see the Tenant Onboarding Flow Spec). Deliberately NOT behind withTenantDb:
 * there is no single tenant to scope these requests to.
 */
export const platformRouter = Router();
platformRouter.use(requireAuth, requirePlatformAdmin);

platformRouter.get("/tenants", listTenantsHandler);
platformRouter.post("/tenants", validate(createTenantSchema), createTenantHandler);
platformRouter.patch("/tenants/:id", validate(updateTenantSchema), updateTenantHandler);
platformRouter.delete("/tenants/:id", deleteTenantHandler);
platformRouter.get("/ai-overview", getAiOverviewHandler);
