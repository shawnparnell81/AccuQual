import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { rejectSupplierReads, requireRole } from "../../middleware/rbac.js";
import { withDb } from "../../lib/requestDb.js";
import { validate } from "../../middleware/validate.js";
import { updateBrandingSchema, updateAiConfigSchema, updateCompanyProfileSchema, updateCompanySecuritySchema, updateOnboardingSchema, updateSidebarLayoutSchema } from "./company.validation.js";
import { getBrandingHandler, updateBrandingHandler, getCompanyLogoHandler, getAiConfigHandler, updateAiConfigHandler, getAssistantNameHandler, getAiUsageHandler, getProfileHandler, updateProfileHandler, getSecurityHandler, updateSecurityHandler, getOnboardingHandler, updateOnboardingHandler, getSidebarLayoutHandler, updateSidebarLayoutHandler, resetSidebarLayoutHandler, listReleaseNotesHandler, createReleaseNoteHandler, archiveReleaseNoteHandler } from "./company.controller.js";

/** A company admin's own settings — the settings of the one company. Admin-only (requireRole), not department-gated: branding/AI config aren't a department concern. */
export const companyRouter = Router();
companyRouter.use(requireAuth, withDb, rejectSupplierReads);

companyRouter.get("/branding", getBrandingHandler);
companyRouter.get("/logo", getCompanyLogoHandler);
companyRouter.patch("/branding", requireRole("admin"), validate(updateBrandingSchema), updateBrandingHandler);

// Admin Console "Company Settings" (Phase 10) — GET open like branding above, PATCH admin-only.
companyRouter.get("/profile", getProfileHandler);
companyRouter.patch("/profile", requireRole("admin"), validate(updateCompanyProfileSchema), updateProfileHandler);

companyRouter.get("/security", getSecurityHandler);
companyRouter.patch("/security", requireRole("admin"), validate(updateCompanySecuritySchema), updateSecurityHandler);

companyRouter.get("/ai-config", requireRole("admin"), getAiConfigHandler);
companyRouter.patch("/ai-config", requireRole("admin"), validate(updateAiConfigSchema), updateAiConfigHandler);

// BYOK usage dashboard — admin only, per "all authenticated users... cannot view usage dashboard".
companyRouter.get("/ai-usage", requireRole("admin"), getAiUsageHandler);

// Open to any authenticated user — see getAssistantNameHandler's own comment.
companyRouter.get("/assistant-name", getAssistantNameHandler);

companyRouter.get("/onboarding", getOnboardingHandler);
companyRouter.patch("/onboarding", requireRole("admin"), validate(updateOnboardingSchema), updateOnboardingHandler);

companyRouter.get("/release-notes", listReleaseNotesHandler);
companyRouter.post("/release-notes", requireDepartmentAccess("management_review"), createReleaseNoteHandler);
companyRouter.post("/release-notes/:id/archive", requireDepartmentAccess("management_review"), archiveReleaseNoteHandler);

companyRouter.get("/sidebar-layout", getSidebarLayoutHandler);
companyRouter.put("/sidebar-layout", requireRole("admin"), validate(updateSidebarLayoutSchema), updateSidebarLayoutHandler);
companyRouter.delete("/sidebar-layout", requireRole("admin"), resetSidebarLayoutHandler);
