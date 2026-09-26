import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
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
// Previously ungated with a comment claiming parity with Document Control —
// that comment was stale: Document Control's own router was gated in an
// earlier sprint specifically because "no RBAC gate at all" was a real bug,
// not a convention (see documents.routes.ts's own comment). This had no
// ResourceKey at all, structurally excluded from the permission system
// (Full-System Audit finding C3). Every department gets edit by default —
// see defaultPermissions.ts's own comment on why this module (unlike
// Change/Training above) has no single owning department, and why "every
// department edit" is zero-behavior-change from today rather than a new
// restriction.
qmsFormsRouter.use(requireAuth, withDb, requireDepartmentAccess("qms_forms"));

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
