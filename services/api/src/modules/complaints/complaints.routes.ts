import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { withSiteContext } from "../sites/siteContext.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createComplaintSchema, updateComplaintSchema, resolveComplaintSchema } from "./complaints.validation.js";
import { baseHandlers, verifyReferences, updateHandler, investigateHandler, resolveHandler, closeHandler, escalateToNcrHandler } from "./complaints.controller.js";

export const complaintsRouter = Router();

// Complaints is shared by 4 departments (Quality/Engineering/Customer Service:
// edit, Production: read-only) — see departmentAccess.ts.
complaintsRouter.use(requireAuth, withTenantDb, withSiteContext, requireDepartmentAccess("complaints"));

/**
 * Lifecycle: open -> investigating -> resolved -> closed (a resolved
 * complaint can go back to investigating). Status moves ONLY through the
 * dedicated endpoints below — the generic PATCH does not accept it (Full-System
 * Audit finding L4 left it a free field; closed now).
 *
 * Escalation to an NCR is still a deliberate action, never automatic: use
 * POST /:id/escalate-to-ncr (or link an existing NCR via linkedNcrId).
 */
complaintsRouter.get("/", baseHandlers.list);
complaintsRouter.post("/", validate(createComplaintSchema), verifyReferences, baseHandlers.create);
complaintsRouter.get("/:id", baseHandlers.getOne);
complaintsRouter.patch("/:id", validate(updateComplaintSchema), verifyReferences, updateHandler);
complaintsRouter.post("/:id/investigate", investigateHandler);
complaintsRouter.post("/:id/resolve", validate(resolveComplaintSchema), resolveHandler);
complaintsRouter.post("/:id/close", closeHandler);
complaintsRouter.post("/:id/escalate-to-ncr", escalateToNcrHandler);
