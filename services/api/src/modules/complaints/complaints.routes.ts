import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { complaints } from "../../drizzle/schema/complaints.js";
import { createComplaintSchema, updateComplaintSchema } from "./complaints.validation.js";

export const complaintsRouter = Router();
const handlers = crudFactory(complaints, { entityName: "Complaint", idColumn: "id" });

// Complaints is shared by 4 departments (Quality/Engineering/Customer Service:
// edit, Production: read-only) — see departmentAccess.ts.
complaintsRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("complaints"));

/**
 * Full-System Audit finding L4 — this module is deliberately minimal-scope,
 * documented explicitly rather than left to look unfinished:
 *  - Plain crudFactory CRUD only. `status` (open/investigating/resolved/
 *    closed — see complaints.validation.ts) is a free field on the generic
 *    PATCH, with no dedicated transition endpoints or ALLOWED_NEXT guard
 *    the way NCR/CAPA enforce their own sequences. Any status can be set
 *    from any other status today.
 *  - `linkedNcrId` (complaints.validation.ts) is a free-form, client-set
 *    reference a complaint can be created or updated with — there is no
 *    automatic "escalate this complaint into a real NCR" workflow trigger
 *    the way audits.controller.ts auto-creates a Discrepancy Investigation
 *    from a nonconformance finding. Linking is manual and one-directional.
 * TODO (not planned/implemented — explicitly out of scope per this
 * finding): a real status-transition guard and/or an NCR-escalation
 * automation would be the natural next steps if this module's real usage
 * ever needs more than "log it, categorize it, link it by hand."
 */

complaintsRouter.get("/", handlers.list);
complaintsRouter.post("/", validate(createComplaintSchema), handlers.create);
complaintsRouter.get("/:id", handlers.getOne);
complaintsRouter.patch("/:id", validate(updateComplaintSchema), handlers.update);
