import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { createScarFormSchema, updateScarFormSchema } from "./scarForms.validation.js";
import { listScarFormsHandler, createScarFormHandler, getScarFormHandler, updateScarFormHandler, deleteScarFormHandler } from "./scarForms.controller.js";

export const scarFormsRouter = Router();
// Deliberately not gated — same convention as Document Control/Document
// Change Request/QMS Forms: any authenticated tenant user may raise/edit
// one, since a SCAR can originate from any department dealing with a supplier.
scarFormsRouter.use(requireAuth, withTenantDb);

scarFormsRouter.get("/", listScarFormsHandler);
scarFormsRouter.post("/", validate(createScarFormSchema), createScarFormHandler);
scarFormsRouter.get("/:id", getScarFormHandler);
scarFormsRouter.patch("/:id", validate(updateScarFormSchema), updateScarFormHandler);
scarFormsRouter.delete("/:id", deleteScarFormHandler);
