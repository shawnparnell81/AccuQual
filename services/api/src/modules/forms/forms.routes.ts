import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { AppError } from "../../utils/appError.js";
import { withDb } from "../../lib/requestDb.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { saveFormSchema, FORM_TYPES } from "./forms.validation.js";
import { getTemplate, getForm, saveForm, createVersion, getHistory, exportForm } from "./forms.controller.js";
import { listTemplatesHandler, uploadTemplateHandler, downloadTemplateHandler, deleteTemplateHandler } from "./formTemplates.controller.js";
import type { ResourceKey } from "../../middleware/departmentAccess.js";

export const formsRouter = Router();
formsRouter.use(requireAuth, withDb);

// memoryStorage: files are small (PDF forms), and uploadTemplateHandler
// decides the on-disk path itself — same convention as document-folders'
// and calibration's certificate upload.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

/**
 * This router is shared by all 35 form types (NCR, CAPA, training, ...). A
 * prior comment here claimed "most aren't in the department matrix and stay
 * gated by their owning record's own permissions" — that was false: this
 * router applied NO gate at all for any type except the Production Log
 * family below, so POST /forms/ncr/:id/save (and every other type's save)
 * could rewrite that record's form content regardless of the caller's real
 * department access to the NCR/CAPA/etc module itself (Full-System Audit
 * finding B1 — a bypass of every other module's own direct-route RBAC).
 *
 * Only mapped here: form types with a CONFIRMED real, actively-enforced
 * module elsewhere in the app (verified by finding a live
 * requireDepartmentAccess(<key>) call on that module's own router) — the
 * exact same access level that module's own direct route already enforces,
 * so this closes the bypass without changing who could already edit that
 * record through its real page. The remaining ~20 form types (bespoke QMS
 * documents like Control Plan, DVP&R, Management Review Minutes, ...) have
 * no corresponding module at all — same "no single owning department"
 * reality already established for qms_forms/document_change_requests, not
 * a new gap introduced by leaving them out of this map.
 */
const FORM_TYPE_TO_RESOURCE: Partial<Record<(typeof FORM_TYPES)[number], ResourceKey>> = {
  ncr: "ncr",
  capa: "capa",
  eight_d: "eight_d",
  audit_checklist: "audit",
  audit_plan: "audit",
  lpa: "audit",
  discrepancy_inspection: "di",
  supplier: "suppliers",
  training: "training",
  change: "change",
  pcn: "change", // Process Change Notice — the same module MODULE_LABELS itself calls "Change / PCN Control"
  calibration: "calibration",
  complaint: "complaints",
  fmea: "risk", // MODULE_LABELS itself calls this ResourceKey "Risk / FMEA"
  document_control_index: "documents",
  // Multi-department (Production: read-only, Customer Service: edit — see
  // departmentAccess.ts) — this app's one form-type family that already
  // had a real, working gate before this fix; folded into the same
  // mechanism instead of keeping a second, parallel one.
  production_log: "production_log",
  daily_production_log: "production_log",
  production_output_log: "production_log",
};

/**
 * Write-path only (POST save/version), matching this finding's own scope
 * and the pre-existing production_log gate's own scope — reads stay open
 * to any authenticated tenant user, unchanged, same as before this fix.
 */
function gateKnownFormTypes(req: Request, res: Response, next: NextFunction) {
  const resourceKey = req.params.type ? FORM_TYPE_TO_RESOURCE[req.params.type as (typeof FORM_TYPES)[number]] : undefined;
  if (!resourceKey) return next();
  return requireDepartmentAccess(resourceKey)(req, res, next);
}

/**
 * Management Review and Context of the Organization are version-controlled documents: what is in force only changes
 * by publishing a reviewed version (see modules/versioning). Their form_data row is written by publishing alone, so
 * the generic save/snapshot endpoints refuse them — otherwise anyone could edit the live document around the review.
 */
const CONTROLLED_FORM_TYPES = new Set(["management_review", "context_of_organization"]);
function refuseControlledForms(req: Request, _res: Response, next: NextFunction) {
  if (req.params.type && CONTROLLED_FORM_TYPES.has(req.params.type)) {
    return next(new AppError("This document is version-controlled. Start a draft under Management System, get it reviewed, and publish it.", 409));
  }
  next();
}

// Fixed literal path before ":type"-shaped ones, same convention used
// throughout this app.
formsRouter.get("/templates", requireRole("admin"), listTemplatesHandler);

formsRouter.get("/:type/template", getTemplate);
formsRouter.post("/:type/template", requireRole("admin"), upload.single("file"), uploadTemplateHandler);
formsRouter.delete("/:type/template", requireRole("admin"), deleteTemplateHandler);
formsRouter.get("/:type/template/file", downloadTemplateHandler);
formsRouter.get("/:type/:id", getForm);
formsRouter.post("/:type/:id/save", refuseControlledForms, gateKnownFormTypes, validate(saveFormSchema), saveForm);
formsRouter.post("/:type/:id/version", refuseControlledForms, gateKnownFormTypes, createVersion);
formsRouter.get("/:type/:id/history", getHistory);
formsRouter.post("/:type/:id/export", exportForm);
