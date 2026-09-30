import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createIsoQualityFormSchema, signIsoQualityFormSchema, updateIsoQualityFormSchema } from "./iso-quality-forms.validation.js";
import { baseHandlers, signIsoQualityForm } from "./iso-quality-forms.controller.js";
import { deleteRecordHandler } from "../records/recordDeletion.js";

export const isoQualityFormsRouter = Router();

// Same gate as the other controlled documents: Quality and Engineering edit, every other department can read.
isoQualityFormsRouter.use(requireAuth, withDb, requireDepartmentAccess("documents"));

isoQualityFormsRouter.get("/", baseHandlers.list);
isoQualityFormsRouter.post("/", validate(createIsoQualityFormSchema), baseHandlers.create);
isoQualityFormsRouter.get("/:id", baseHandlers.getOne);
isoQualityFormsRouter.patch("/:id", validate(updateIsoQualityFormSchema), baseHandlers.update);
isoQualityFormsRouter.post("/:id/sign", validate(signIsoQualityFormSchema), signIsoQualityForm);
isoQualityFormsRouter.delete("/:id", deleteRecordHandler("iso_quality_form"));
