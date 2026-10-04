import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { logger } from "../../utils/logger.js";
import * as formsService from "./forms.service.js";
import { FORM_AUDIT_ENTITY } from "./forms.service.js";
import { createCalibrationEvent } from "../calibration/calibration.controller.js";
import { assertGageUsable, assertInspectionGagesUsable } from "../calibration/calibration.service.js";
import { completeTrainingAssignment } from "../training/training.controller.js";
import { DI_FORM_TYPE, syncDiFormToRecord } from "../quality/quality.formSync.js";
import { COMPLAINT_FORM_TYPE, syncComplaintFormToRecord } from "../complaints/complaints.formSync.js";
import { parseApqpSummaryData } from "./apqpSummary.validation.js";
import { noteRepeatNcr } from "../quality-automation/qualityAutomation.service.js";
import { requireSignatureStamp } from "../signatures/signaturePin.service.js";
import { writeSignatureValue } from "../signatures/signaturePin.js";

export const getTemplate = asyncHandler(async (req: Request, res: Response) => {
  const formType = req.params.type!;
  const template = await formsService.loadTemplate(req.db!, formType);
  const presented = formsService.presentForm(formType, { data: {} });
  res.json({ ...template, templateRevision: presented?.templateRevision, templateVersion: presented?.templateVersion });
});

export const getForm = asyncHandler(async (req: Request, res: Response) => {
  const entityId = req.params.id ? Number(req.params.id) : undefined;
  const formType = req.params.type!;
  const form = await formsService.loadData(req.db!, formType, entityId);
  res.json(formsService.presentForm(formType, form));
});

export const saveForm = asyncHandler(async (req: Request, res: Response) => {
  const entityId = req.params.id ? Number(req.params.id) : undefined;
  const data =
    req.params.type === "apqp_summary" && req.body.data && typeof req.body.data === "object"
      ? parseApqpSummaryData(req.body.data as Record<string, unknown>)
      : req.body.data;
  const savedEntityId = req.body.entityId ?? entityId;
  const gageEquipmentId = Number(savedEntityId);
  if (req.params.type === "gage_rr" && Number.isInteger(gageEquipmentId) && gageEquipmentId > 0) {
    await assertGageUsable(req.db!, gageEquipmentId);
  }
  if (req.params.type === "final_inspection_release_checklist" && data && typeof data === "object" && !Array.isArray(data)) {
    await assertInspectionGagesUsable(req.db!, data as Record<string, unknown>);
  }
  const saved = await formsService.saveData(req.db!, {
    formType: req.params.type!,
    entityType: req.body.entityType,
    entityId: req.body.entityId ?? entityId,
    data,
    userId: req.user?.id,
  });

  // The DI form and its discrepancy record share title/severity/description/
  // disposition — flow the descriptive fields back to the record (status
  // never does). See quality.formSync.ts.
  if (req.params.type === DI_FORM_TYPE && savedEntityId != null && req.body.data && typeof req.body.data === "object") {
    await syncDiFormToRecord(req.db!, Number(savedEntityId), req.body.data as Record<string, unknown>, req.user?.id);
  }
  if (req.params.type === COMPLAINT_FORM_TYPE && savedEntityId != null && req.body.data && typeof req.body.data === "object") {
    await syncComplaintFormToRecord(req.db!, Number(savedEntityId), req.body.data as Record<string, unknown>, req.user?.id);
  }
  if (req.params.type === "ncr" && savedEntityId != null) await noteRepeatNcr(req.db!, Number(savedEntityId));

  res.json(saved);
});

/** PIN plus the certification checkbox. The stamp is the signer's display name and the time in the company timezone. */
export const signForm = asyncHandler(async (req: Request, res: Response) => {
  const entityId = Number(req.params.id);
  const formType = req.params.type!;
  const existing = await formsService.loadData(req.db!, formType, entityId);
  const current = (existing?.data ?? {}) as Record<string, unknown>;
  const path = String(req.body.path);
  try {
    writeSignatureValue(current, path, "pending", "2000-01-01");
  } catch (err) {
    if (err instanceof Error && err.message === "That signature field is not recognized.") throw AppError.badRequest(err.message);
    throw err;
  }
  const stamp = await requireSignatureStamp(req, {
    pin: req.body.pin,
    certified: req.body.certified,
    entityType: FORM_AUDIT_ENTITY[formType] ?? formType,
    entityId,
    field: path,
    description: String(req.body.description),
  });
  const next = writeSignatureValue(current, path, stamp.stamp, stamp.signedOn);
  await formsService.saveData(req.db!, {
    formType,
    entityType: existing?.entityType ?? req.body.entityType ?? formType,
    entityId,
    data: next,
    userId: req.user?.id,
    trustSignatures: true,
  });
  res.json({ stamp: stamp.stamp, signedAt: stamp.signedAt.toISOString(), signedOn: stamp.signedOn, displayName: stamp.displayName });
});

// `:id` is the entity id (the NCR/CAPA/... row this form is attached to) across
// every route in this module, matching what a frontend "Open Form" button has
// on hand — not form_data's own internal id. These two resolve it first.

export const createVersion = asyncHandler(async (req: Request, res: Response) => {
  const current = await formsService.loadData(req.db!, req.params.type!, Number(req.params.id));
  if (!current) throw AppError.notFound("Form");
  const updated = await formsService.createVersion(req.db!, current.id, req.user?.id);

  // The "Calibration Record" form is the single source of truth for a
  // calibration event, but its form_data row is a continuously-autosaving
  // draft (see forms.service.ts's saveData) shared by every field edit —
  // writing a real calibrations row on every autosave would flood the
  // equipment's history with duplicates. "Save version" is this engine's one
  // deliberate, user-initiated "finalize this" action, so that's the trigger
  // for actually logging the event (and the due-date/status recompute that
  // comes with it), not every keystroke.
  if (req.params.type === "calibration" && current.entityId != null) {
    await maybeLogCalibrationEvent(req, current.entityId, current.data);
  }

  // Same reasoning as Calibration above: the "Training Record" form's
  // entityId is the specific trainingAssignments row (one employee's one
  // assignment to a course) — NOT the course id, which every employee
  // taking that course would otherwise share and silently overwrite each
  // other's form_data row. "Save version" (relabeled "Complete Training" for
  // this formType, see FormEditor.tsx) is what marks that assignment
  // complete.
  if (req.params.type === "training" && current.entityId != null) {
    await maybeCompleteTrainingAssignment(req, current.entityId, current.data);
  }

  res.json(updated);
});

async function maybeLogCalibrationEvent(req: Request, equipmentId: number, data: Record<string, unknown>): Promise<void> {
  const performedAt = data.performedAt ? new Date(String(data.performedAt)) : null;
  if (!performedAt || Number.isNaN(performedAt.getTime())) {
    logger.warn(`Skipped auto-creating a calibration event for equipment ${equipmentId}: no valid performedAt in the form yet`);
    return;
  }
  await createCalibrationEvent(
    req.db!,
    equipmentId,
    {
      performedAt,
      result: typeof data.result === "string" ? data.result : undefined,
      technicianName: typeof data.technicianName === "string" ? data.technicianName : undefined,
      notes: typeof data.notes === "string" ? data.notes : undefined,
    },
    req.user?.id
  );
}

async function maybeCompleteTrainingAssignment(req: Request, assignmentId: number, data: Record<string, unknown>): Promise<void> {
  const completionDate = data.completionDate ? new Date(String(data.completionDate)) : null;
  if (!completionDate || Number.isNaN(completionDate.getTime())) {
    logger.warn(`Skipped auto-completing training assignment ${assignmentId}: no valid completionDate in the form yet`);
    return;
  }
  await completeTrainingAssignment(
    req.db!,
    assignmentId,
    {
      completedAt: completionDate,
      trainerName: typeof data.trainerName === "string" ? data.trainerName : undefined,
      notes: typeof data.notes === "string" ? data.notes : undefined,
    },
    req.user?.id
  );
}

export const getHistory = asyncHandler(async (req: Request, res: Response) => {
  const current = await formsService.loadData(req.db!, req.params.type!, Number(req.params.id));
  if (!current) throw AppError.notFound("Form");
  res.json(await formsService.listVersions(req.db!, current.id));
});

export const exportForm = asyncHandler(async (req: Request, res: Response) => {
  const entityId = req.params.id ? Number(req.params.id) : undefined;
  const pdf = await formsService.exportPdf(req.db!, req.params.type!, entityId, req.user?.id);
  res.setHeader("Content-Type", "application/pdf");
  if (pdf.exportId) res.setHeader("X-Export-Id", pdf.exportId);
  res.setHeader("Content-Disposition", `attachment; filename="${req.params.type}-${entityId ?? "form"}.pdf"`);
  res.send(Buffer.from(pdf.bytes));
});
