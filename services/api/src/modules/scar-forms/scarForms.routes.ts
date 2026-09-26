import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { validate } from "../../middleware/validate.js";
import { createScarFormSchema, updateScarFormSchema } from "./scarForms.validation.js";
import { listScarFormsHandler, createScarFormHandler, getScarFormHandler, updateScarFormHandler, deleteScarFormHandler } from "./scarForms.controller.js";

export const scarFormsRouter = Router();
// Security-audit finding (medium): this comment used to justify staying
// ungated by citing QMS Forms as a sibling with the same "deliberately
// open" convention — but QMS Forms was fixed earlier in this same audit
// series (requireDepartmentAccess("qms_forms")) specifically so it would
// be real and company-configurable instead of invisible to the permission
// system. SCAR gets the same treatment now, same all-departments-edit
// default (defaultPermissions.ts) so this is zero-behavior-change from
// today, just makes it real and configurable.
scarFormsRouter.use(requireAuth, withDb, requireDepartmentAccess("scar"));

scarFormsRouter.get("/", listScarFormsHandler);
scarFormsRouter.post("/", validate(createScarFormSchema), createScarFormHandler);
scarFormsRouter.get("/:id", getScarFormHandler);
scarFormsRouter.patch("/:id", validate(updateScarFormSchema), updateScarFormHandler);
scarFormsRouter.delete("/:id", deleteScarFormHandler);
