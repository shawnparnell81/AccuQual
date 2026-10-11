import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { logger } from "../../utils/logger.js";
import * as formsService from "./forms.service.js";
import { FORM_AUDIT_ENTITY } from "./forms.service.js";
import { createCalibrationEvent } from "../calibration/calibration.controller.js";
import { assertGageUsable, assertInspectionGagesUsable } from "../calibration/calibration.service.js";
import { completeTrainingAssignment } from "../training/training.controller.js";
import { syncAuditChecklist } from "../audits/audits.controller.js";
import { DI_FORM_TYPE, syncDiFormToRecord } from "../quality/quality.formSync.js";
import { COMPLAINT_FORM_TYPE, syncComplaintFormToRecord } from "../complaints/complaints.formSync.js";
import { parseApqpSummaryData } from "./apqpSummary.validation.js";
import { noteRepeatNcr } from "../quality-automation/qualityAutomation.service.js";
import { syncDocumentToRecord } from "../ncr/ncr.service.js";
import { requireSignatureStamp } from "../signatures/signaturePin.service.js";
import { writeSignatureValue } from "../signatures/signaturePin.js";
import { NCR_CLOSURE_SIGNOFF_PERMISSION } from "../roles/roleAccess.js";
import { roleHasPermission } from "../roles/rolePermissions.js";
import { reasonableDate } from "../../utils/validation.js";
import { eq } from "drizzle-orm";
import { ncr } from "../../drizzle/schema/ncr.js";

/** Reject if the NCR is closed/locked. */
async function rejectClosedNcr(db: any, ncrId: number): Promise<void> {
  const [row] = await db.select({ processData: ncr.processData }).from(ncr).where(eq(ncr.id, ncrId));
  if ((row?.processData as any)?.locked === true) throw AppError.badRequest("This NCR is closed and locked.");
}

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
  if (req.params.type === "audit_checklist" && savedEntityId != null && data && typeof data === "object" && !Array.isArray(data)) {
    await syncAuditChecklist(req.db!, Number(savedEntityId), data as Record<string, unknown>, req.user?.id);
  }
  if (req.params.type === "ncr" && savedEntityId != null) {
    const savedData = saved && typeof saved === "object" && "data" in saved && saved.data && typeof saved.data === "object" ? (saved.data as Record<string, unknown>) : null;
    if (savedData) await syncDocumentToRecord(req.db!, Number(savedEntityId), savedData, req.user?.id);
    await noteRepeatNcr(req.db!, Number(savedEntityId));
  }

  res.json(saved);
});

/** PIN plus the certification checkbox. The stamp is the signer's display name and the time in the company timezone. */
export const signForm = asyncHandler(async (req: Request, res: Response) => {
  const entityId = Number(req.params.id);
  const formType = req.params.type!;
  const existing = await formsService.loadData(req.db!, formType, entityId);
  const current = (existing?.data ?? {}) as Record<string, unknown>;
  const path = String(req.body.path);
  // NCR closure rows: reject if the NCR is closed/locked.
  if (formType === "ncr" && path.startsWith("closureApprovals.")) {
    await rejectClosedNcr(req.db!, entityId);
  }
  // Row 0 of NCR closure (the required Quality Manager sign-off) needs the ncr.closure_signoff permission.
  // The permission is stored on the role; a role name does not grant it.
  if (formType === "ncr" && path === "closureApprovals.0.signature") {
    const roleName = (req.user as any)?.role ?? (req.user as any)?.roleName;
    const allowed = await roleHasPermission(req.db!, roleName, NCR_CLOSURE_SIGNOFF_PERMISSION);
    if (!allowed) {
      logger.warn(`permission_denied: user ${req.user?.id} lacks ${NCR_CLOSURE_SIGNOFF_PERMISSION} for NCR ${entityId} closure row 0`);
      throw AppError.forbidden("You don't have permission to sign the required closure sign-off row.");
    }
  }
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

/**
 * Mark an NCR closure row (index 1+) as "Not required" with PIN verification.
 * Row 0 (the required Quality Manager sign-off) can never be Not required.
 * Refuses if the row already has a real signature. Requires the NCR to be open.
 */
export const markNotRequired = asyncHandler(async (req: Request, res: Response) => {
  const entityId = Number(req.params.id);
  const formType = req.params.type!;
  if (formType !== "ncr") throw AppError.badRequest("Not required is only for NCR closure rows.");
  await rejectClosedNcr(req.db!, entityId);
  const path = String(req.body.path);
  const match = path.match(/^closureApprovals\.(\d+)\.signature$/);
  if (!match) throw AppError.badRequest("Invalid closure row path.");
  const index = Number(match[1]);
  if (index === 0) throw AppError.badRequest("The required Quality Manager sign-off cannot be marked Not required.");

  const existing = await formsService.loadData(req.db!, formType, entityId);
  const current = (existing?.data ?? {}) as Record<string, unknown>;
  const rows = Array.isArray((current as any).closureApprovals) ? (current as any).closureApprovals as Record<string, unknown>[] : [];
  const row = rows[index] ?? {};
  const sig = typeof row.signature === "string" ? row.signature : "";
  // Refuse if already signed (a real signature, not a Not-required mark).
  if (sig && !sig.startsWith("Not required")) throw AppError.badRequest("This row is already signed.");

  const stamp = await requireSignatureStamp(req, {
    pin: req.body.pin,
    certified: req.body.certified,
    entityType: FORM_AUDIT_ENTITY[formType] ?? formType,
    entityId,
    field: path,
    description: String(req.body.description ?? "Mark closure row Not required"),
  });
  const mark = `Not required – ${stamp.stamp}`;
  const nextRows = [...rows];
  while (nextRows.length <= index) nextRows.push({});
  nextRows[index] = { ...nextRows[index], signature: mark, date: stamp.signedOn };
  const next = { ...current, closureApprovals: nextRows };
  await formsService.saveData(req.db!, {
    formType,
    entityType: existing?.entityType ?? req.body.entityType ?? formType,
    entityId,
    data: next,
    userId: req.user?.id,
    trustSignatures: true,
  });
  res.json({ mark, signedOn: stamp.signedOn });
});

/**
 * Clear a "Not required" mark from an NCR closure row. Only allowed when the row
 * holds a Not-required mark — never erases a real signature. Uses SignatureStamp (PIN).
 */
export const clearNotRequired = asyncHandler(async (req: Request, res: Response) => {
  const entityId = Number(req.params.id);
  const formType = req.params.type!;
  if (formType !== "ncr") throw AppError.badRequest("Not required is only for NCR closure rows.");
  await rejectClosedNcr(req.db!, entityId);
  const path = String(req.body.path);
  const match = path.match(/^closureApprovals\.(\d+)\.signature$/);
  if (!match) throw AppError.badRequest("Invalid closure row path.");
  const index = Number(match[1]);

  const existing = await formsService.loadData(req.db!, formType, entityId);
  const current = (existing?.data ?? {}) as Record<string, unknown>;
  const rows = Array.isArray((current as any).closureApprovals) ? (current as any).closureApprovals as Record<string, unknown>[] : [];
  const row = rows[index] ?? {};
  const sig = typeof row.signature === "string" ? row.signature : "";
  if (!sig.startsWith("Not required")) throw AppError.badRequest("This row does not hold a Not required mark.");

  await requireSignatureStamp(req, {
    pin: req.body.pin,
    certified: req.body.certified,
    entityType: FORM_AUDIT_ENTITY[formType] ?? formType,
    entityId,
    field: path,
    description: String(req.body.description ?? "Clear Not required mark"),
  });
  const nextRows = [...rows];
  nextRows[index] = { ...nextRows[index], signature: "", date: "" };
  const next = { ...current, closureApprovals: nextRows };
  await formsService.saveData(req.db!, {
    formType,
    entityType: existing?.entityType ?? req.body.entityType ?? formType,
    entityId,
    data: next,
    userId: req.user?.id,
    trustSignatures: true,
  });
  res.json({ cleared: true });
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
  let calibrationEventLogged: boolean | undefined;
  if (req.params.type === "calibration" && current.entityId != null) {
    calibrationEventLogged = await maybeLogCalibrationEvent(req, current.entityId, current.data);
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

  // Tell the client whether the version actually produced a calibration
  // event: without a valid performed date the event is skipped server-side,
  // and the UI must say so instead of toasting success.
  res.json(calibrationEventLogged === undefined ? updated : { ...updated, calibrationEventLogged });
});

function formCalendarDate(value: unknown): Date | null {
  const parsed = reasonableDate.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function maybeLogCalibrationEvent(req: Request, equipmentId: number, data: Record<string, unknown>): Promise<boolean> {
  const performedAt = formCalendarDate(data.performedAt);
  if (!performedAt) {
    logger.warn(`Skipped auto-creating a calibration event for equipment ${equipmentId}: no valid performedAt in the form yet`);
    return false;
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
  return true;
}

async function maybeCompleteTrainingAssignment(req: Request, assignmentId: number, data: Record<string, unknown>): Promise<void> {
  const completionDate = formCalendarDate(data.completionDate);
  if (!completionDate) {
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
