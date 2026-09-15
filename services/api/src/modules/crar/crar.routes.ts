import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createCrarSchema, updateCrarSchema, transitionCrarSchema } from "./crar.validation.js";
import { listCrarHandler, createCrarHandler, getCrarHandler, updateCrarHandler, transitionCrarHandler } from "./crar.controller.js";

export const crarRouter = Router();
// quality edit, customer_service read, engineering/purchasing edit-but-
// narrowed-to-the-warrantyId-link-field-only — see departmentAccess.ts's
// PERMISSION_MATRIX.crar and crar.controller.ts's own assertDepartment
// calls for the real per-action split this binary matrix can't express.
crarRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("crar"));

crarRouter.get("/", listCrarHandler);
crarRouter.post("/", validate(createCrarSchema), createCrarHandler);
crarRouter.get("/:id", getCrarHandler);
crarRouter.patch("/:id", validate(updateCrarSchema), updateCrarHandler);
// Not in the brief's own literal 4-route list, but a real transition
// mechanism is required by its own workflow requirement — same "the route
// list is a floor, not a ceiling" precedent as every other module built
// this session (e.g. Warranty's /costs, Supplier Portal's /review routes).
crarRouter.post("/:id/transition", validate(transitionCrarSchema), transitionCrarHandler);
