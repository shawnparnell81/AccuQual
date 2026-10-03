import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/auth.js";
import { AppError } from "../../utils/appError.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { withDb } from "../../lib/requestDb.js";
import { validate } from "../../middleware/validate.js";
import { getUserAccessLevel, requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { saveFormSchema, signFormSchema, FORM_TYPES } from "./forms.validation.js";
import { getTemplate, getForm, saveForm, signForm, createVersion, getHistory, exportForm } from "./forms.controller.js";
import { listTemplatesHandler, uploadTemplateHandler, downloadTemplateHandler, deleteTemplateHandler } from "./formTemplates.controller.js";
import type { ResourceKey } from "../../middleware/departmentAccess.js";
import { canEditFormStructure } from "../roles/roleHierarchy.js";
import { isFullAccessRole } from "../roles/roleAccess.js";

export const formsRouter = Router();

/**
 * Supplier logins do not read or export company forms. rejectSupplierReads
 * only covers GET/HEAD, and export is a POST, so this router refuses the
 * role on every method.
 */
function rejectSupplierForms(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.roleName === "supplier") {
    next(AppError.forbidden("Supplier logins can't open this."));
    return;
  }
  next();
}

formsRouter.use(requireAuth, withDb, rejectSupplierForms);

// memoryStorage: files are small (PDF forms), and uploadTemplateHandler
// decides the on-disk path itself — same convention as document-folders'
// and calibration's certificate upload.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

/**
 * Form type -> the module that already gates that record. Reads, history,
 * and export use the same audience as that module (anyone with read or
 * edit). Saves and new versions still require edit. A type with no module
 * is refused.
 */
const FORM_TYPE_TO_RESOURCE: Partial<Record<(typeof FORM_TYPES)[number], ResourceKey>> = {
  ncr: "ncr",
  five_why: "ncr",
  capa: "capa",
  eight_d: "eight_d",
  audit_checklist: "audit",
  audit_plan: "audit",
  lpa: "audit",
  discrepancy_inspection: "di",
  supplier: "suppliers",
  approved_vendor_list: "suppliers",
  training: "training",
  competency_matrix: "training",
  change: "change",
  pcn: "change",
  calibration: "calibration",
  gage_rr: "calibration",
  maintenance_work_order: "calibration",
  complaint: "complaints",
  fmea: "risk",
  document_control_index: "documents",
  production_log: "production_log",
  daily_production_log: "production_log",
  production_output_log: "production_log",
  appearance_approval: "ppap",
  apqp_summary: "ppap",
  control_plan: "ppap",
  dimensional_report: "ppap",
  process_flow_diagram: "ppap",
  dvpr: "ppap",
  final_inspection_release_checklist: "ppap",
  management_review: "management_review",
  management_review_minutes: "management_review",
  staff_meeting_minutes: "management_review",
  context_of_organization: "context_of_org",
  pareto_chart: "ncr",
};

function resourceFor(req: Request): ResourceKey | undefined {
  const type = req.params.type as (typeof FORM_TYPES)[number] | undefined;
  if (!type) return undefined;
  return FORM_TYPE_TO_RESOURCE[type];
}

/** Saves and versions. Unmapped types are refused. Read access is not enough to write. */
function gateKnownFormTypes(req: Request, res: Response, next: NextFunction) {
  const resourceKey = resourceFor(req);
  if (!resourceKey) return next(AppError.forbidden("That form isn't available."));
  return requireDepartmentAccess(resourceKey)(req, res, next);
}

/**
 * Opening, history, and export. Export is a POST, so the write gate would
 * treat a read-only department as blocked. Read or edit on the owning
 * module is enough. Unmapped types are refused.
 */
function gateFormRead(req: Request, res: Response, next: NextFunction) {
  const resourceKey = resourceFor(req);
  if (!resourceKey) return next(AppError.forbidden("That form isn't available."));
  return asyncHandler(async (inner: Request, _res: Response, innerNext: NextFunction) => {
    if (isFullAccessRole(inner.user?.roleName)) return innerNext();
    if (!inner.user || !inner.db) return innerNext(AppError.forbidden(`No access to '${resourceKey}' for your department`));
    const level = await getUserAccessLevel(inner.db, inner.user, resourceKey);
    if (level === "none") return innerNext(AppError.forbidden(`No access to '${resourceKey}' for your department`));
    innerNext();
  })(req, res, next);
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
/** Replacing the master template file. Filling a form does not use this gate. */
function requireFormStructureEditor(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(AppError.unauthorized());
  if (!canEditFormStructure(req.user)) {
    return next(AppError.forbidden("Changing a form template is limited to quality and engineering roles."));
  }
  next();
}

formsRouter.get("/templates", requireFormStructureEditor, listTemplatesHandler);

formsRouter.get("/:type/template", getTemplate);
formsRouter.post("/:type/template", requireFormStructureEditor, upload.single("file"), uploadTemplateHandler);
formsRouter.delete("/:type/template", requireFormStructureEditor, deleteTemplateHandler);
formsRouter.get("/:type/template/file", downloadTemplateHandler);
formsRouter.get("/:type/:id", gateFormRead, getForm);
formsRouter.post("/:type/:id/save", refuseControlledForms, gateKnownFormTypes, validate(saveFormSchema), saveForm);
formsRouter.post("/:type/:id/sign", refuseControlledForms, gateKnownFormTypes, validate(signFormSchema), signForm);
formsRouter.post("/:type/:id/version", refuseControlledForms, gateKnownFormTypes, createVersion);
formsRouter.get("/:type/:id/history", gateFormRead, getHistory);
formsRouter.post("/:type/:id/export", gateFormRead, exportForm);
