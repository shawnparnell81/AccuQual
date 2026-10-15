import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { rejectSupplierReads, requireRolePermission } from "../../middleware/rbac.js";
import { ADMIN_CONSOLE_PERMISSION } from "../roles/roleAccess.js";
import { withDb } from "../../lib/requestDb.js";
import { validate } from "../../middleware/validate.js";
import { updateBrandingSchema, updateAiConfigSchema, updateCompanyProfileSchema, updateCompanySecuritySchema, updateOnboardingSchema, updateSidebarLayoutSchema } from "./company.validation.js";
import { getBrandingHandler, updateBrandingHandler, getCompanyLogoHandler, getAiConfigHandler, updateAiConfigHandler, getAssistantNameHandler, getAiUsageHandler, getProfileHandler, updateProfileHandler, getSecurityHandler, updateSecurityHandler, getOnboardingHandler, updateOnboardingHandler, getSidebarLayoutHandler, updateSidebarLayoutHandler, resetSidebarLayoutHandler, listReleaseNotesHandler, createReleaseNoteHandler, archiveReleaseNoteHandler } from "./company.controller.js";

/** A company admin's own settings — the settings of the one company. Admin console permission only, not department-gated: branding/AI config aren't a department concern. */
export const companyRouter = Router();
companyRouter.use(requireAuth, withDb, rejectSupplierReads);

companyRouter.get("/branding", getBrandingHandler);
companyRouter.get("/logo", getCompanyLogoHandler);
companyRouter.patch("/branding", requireRolePermission(ADMIN_CONSOLE_PERMISSION), validate(updateBrandingSchema), updateBrandingHandler);

// Admin Console "Company Settings" (Phase 10) — GET open like branding above, PATCH admin-only.
companyRouter.get("/profile", getProfileHandler);
companyRouter.patch("/profile", requireRolePermission(ADMIN_CONSOLE_PERMISSION), validate(updateCompanyProfileSchema), updateProfileHandler);

companyRouter.get("/security", getSecurityHandler);
companyRouter.patch("/security", requireRolePermission(ADMIN_CONSOLE_PERMISSION), validate(updateCompanySecuritySchema), updateSecurityHandler);

companyRouter.get("/ai-config", requireRolePermission(ADMIN_CONSOLE_PERMISSION), getAiConfigHandler);
companyRouter.patch("/ai-config", requireRolePermission(ADMIN_CONSOLE_PERMISSION), validate(updateAiConfigSchema), updateAiConfigHandler);

// BYOK usage dashboard — admin only, per "all authenticated users... cannot view usage dashboard".
companyRouter.get("/ai-usage", requireRolePermission(ADMIN_CONSOLE_PERMISSION), getAiUsageHandler);

// Open to any authenticated user — see getAssistantNameHandler's own comment.
companyRouter.get("/assistant-name", getAssistantNameHandler);

companyRouter.get("/onboarding", getOnboardingHandler);
companyRouter.patch("/onboarding", requireRolePermission(ADMIN_CONSOLE_PERMISSION), validate(updateOnboardingSchema), updateOnboardingHandler);

companyRouter.get("/release-notes", listReleaseNotesHandler);
companyRouter.post("/release-notes", requireDepartmentAccess("management_review"), createReleaseNoteHandler);
companyRouter.post("/release-notes/:id/archive", requireDepartmentAccess("management_review"), archiveReleaseNoteHandler);

companyRouter.get("/sidebar-layout", getSidebarLayoutHandler);
companyRouter.put("/sidebar-layout", requireRolePermission(ADMIN_CONSOLE_PERMISSION), validate(updateSidebarLayoutSchema), updateSidebarLayoutHandler);
companyRouter.delete("/sidebar-layout", requireRolePermission(ADMIN_CONSOLE_PERMISSION), resetSidebarLayoutHandler);
