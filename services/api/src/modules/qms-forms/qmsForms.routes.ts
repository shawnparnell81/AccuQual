import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { createQmsFormSchema, updateQmsFormSchema, createQmsFormRowSchema, updateQmsFormRowSchema } from "./qmsForms.validation.js";
import {
  listQmsFormTypesHandler,
  listQmsFormsHandler,
  createQmsFormHandler,
  getQmsFormHandler,
  updateQmsFormHandler,
  deleteQmsFormHandler,
  createQmsFormRowHandler,
  updateQmsFormRowHandler,
  deleteQmsFormRowHandler,
} from "./qmsForms.controller.js";

export const qmsFormsRouter = Router();
// Deliberately not gated with requireDepartmentAccess — same convention as
// Document Control/Document Change Request: any authenticated tenant user
// may raise/edit one, since these 35 form types each belong to a different
// department's own real work (see qmsFormDefinitions.ts's folderPath).
qmsFormsRouter.use(requireAuth, withTenantDb);

// Fixed literal path before ":id"-shaped ones, same convention used throughout this app.
qmsFormsRouter.get("/types", listQmsFormTypesHandler);

qmsFormsRouter.get("/", listQmsFormsHandler);
qmsFormsRouter.post("/", validate(createQmsFormSchema), createQmsFormHandler);
qmsFormsRouter.get("/:id", getQmsFormHandler);
qmsFormsRouter.patch("/:id", validate(updateQmsFormSchema), updateQmsFormHandler);
qmsFormsRouter.delete("/:id", deleteQmsFormHandler);

qmsFormsRouter.post("/:id/rows", validate(createQmsFormRowSchema), createQmsFormRowHandler);
qmsFormsRouter.patch("/:id/rows/:rowId", validate(updateQmsFormRowSchema), updateQmsFormRowHandler);
qmsFormsRouter.delete("/:id/rows/:rowId", deleteQmsFormRowHandler);
