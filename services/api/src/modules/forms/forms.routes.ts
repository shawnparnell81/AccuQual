import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { saveFormSchema } from "./forms.validation.js";
import { getTemplate, getForm, saveForm, createVersion, getHistory, exportForm } from "./forms.controller.js";

export const formsRouter = Router();
formsRouter.use(requireAuth, withTenantDb);

formsRouter.get("/:type/template", getTemplate);
formsRouter.get("/:type/:id", getForm);
formsRouter.post("/:type/:id/save", validate(saveFormSchema), saveForm);
formsRouter.post("/:type/:id/version", createVersion);
formsRouter.get("/:type/:id/history", getHistory);
formsRouter.post("/:type/:id/export", exportForm);
