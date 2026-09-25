import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { withDb } from "../../lib/requestDb.js";
import { validate } from "../../middleware/validate.js";
import { updateBrandingSchema, updateAiConfigSchema, updateTenantProfileSchema, updateTenantSecuritySchema, updateOnboardingSchema } from "./company.validation.js";
import { getBrandingHandler, updateBrandingHandler, getAiConfigHandler, updateAiConfigHandler, getAssistantNameHandler, getAiUsageHandler, getProfileHandler, updateProfileHandler, getSecurityHandler, updateSecurityHandler, getOnboardingHandler, updateOnboardingHandler } from "./company.controller.js";

/** A tenant admin's own settings — scoped to req.tenantId, never a foreign tenant id. Admin-only (requireRole), not department-gated: branding/AI config aren't a department concern. */
export const companyRouter = Router();
companyRouter.use(requireAuth, withDb);

companyRouter.get("/branding", getBrandingHandler);
companyRouter.patch("/branding", requireRole("admin"), validate(updateBrandingSchema), updateBrandingHandler);

// Admin Console "Company Settings" (Phase 10) — GET open like branding above, PATCH admin-only.
companyRouter.get("/profile", getProfileHandler);
companyRouter.patch("/profile", requireRole("admin"), validate(updateTenantProfileSchema), updateProfileHandler);

companyRouter.get("/security", getSecurityHandler);
companyRouter.patch("/security", requireRole("admin"), validate(updateTenantSecuritySchema), updateSecurityHandler);

companyRouter.get("/ai-config", requireRole("admin"), getAiConfigHandler);
companyRouter.patch("/ai-config", requireRole("admin"), validate(updateAiConfigSchema), updateAiConfigHandler);

// BYOK usage dashboard — admin only, per "all authenticated users... cannot view usage dashboard".
companyRouter.get("/ai-usage", requireRole("admin"), getAiUsageHandler);

// Open to any authenticated user — see getAssistantNameHandler's own comment.
companyRouter.get("/assistant-name", getAssistantNameHandler);

companyRouter.get("/onboarding", getOnboardingHandler);
companyRouter.patch("/onboarding", requireRole("admin"), validate(updateOnboardingSchema), updateOnboardingHandler);
