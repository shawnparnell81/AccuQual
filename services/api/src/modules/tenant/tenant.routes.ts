import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { updateBrandingSchema, updateAiConfigSchema, updateTenantProfileSchema, updateTenantSecuritySchema, updateOnboardingSchema } from "./tenant.validation.js";
import { getBrandingHandler, updateBrandingHandler, getAiConfigHandler, updateAiConfigHandler, getAssistantNameHandler, getAiUsageHandler, getProfileHandler, updateProfileHandler, getSecurityHandler, updateSecurityHandler, getOnboardingHandler, updateOnboardingHandler } from "./tenant.controller.js";

/** A tenant admin's own settings — scoped to req.tenantId, never a foreign tenant id. Admin-only (requireRole), not department-gated: branding/AI config aren't a department concern. */
export const tenantRouter = Router();
tenantRouter.use(requireAuth, withTenantDb);

tenantRouter.get("/branding", getBrandingHandler);
tenantRouter.patch("/branding", requireRole("admin"), validate(updateBrandingSchema), updateBrandingHandler);

// Admin Console "Tenant Settings" (Phase 10) — GET open like branding above, PATCH admin-only.
tenantRouter.get("/profile", getProfileHandler);
tenantRouter.patch("/profile", requireRole("admin"), validate(updateTenantProfileSchema), updateProfileHandler);

tenantRouter.get("/security", getSecurityHandler);
tenantRouter.patch("/security", requireRole("admin"), validate(updateTenantSecuritySchema), updateSecurityHandler);

tenantRouter.get("/ai-config", requireRole("admin"), getAiConfigHandler);
tenantRouter.patch("/ai-config", requireRole("admin"), validate(updateAiConfigSchema), updateAiConfigHandler);

// BYOK usage dashboard — admin only, per "all authenticated users... cannot view usage dashboard".
tenantRouter.get("/ai-usage", requireRole("admin"), getAiUsageHandler);

// Open to any authenticated user — see getAssistantNameHandler's own comment.
tenantRouter.get("/assistant-name", getAssistantNameHandler);

tenantRouter.get("/onboarding", getOnboardingHandler);
tenantRouter.patch("/onboarding", requireRole("admin"), validate(updateOnboardingSchema), updateOnboardingHandler);
