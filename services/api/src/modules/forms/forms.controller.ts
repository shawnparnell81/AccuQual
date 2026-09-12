import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { logger } from "../../utils/logger.js";
import * as formsService from "./forms.service.js";
import { createCalibrationEvent } from "../calibration/calibration.controller.js";
import { completeTrainingAssignment } from "../training/training.controller.js";

export const getTemplate = asyncHandler(async (req: Request, res: Response) => {
  const template = await formsService.loadTemplate(req.db!, req.tenantId!, req.params.type!);
  res.json(template);
});

export const getForm = asyncHandler(async (req: Request, res: Response) => {
  const entityId = req.params.id ? Number(req.params.id) : undefined;
  const form = await formsService.loadData(req.db!, req.tenantId!, req.params.type!, entityId);
  res.json(form);
});

export const saveForm = asyncHandler(async (req: Request, res: Response) => {
  const entityId = req.params.id ? Number(req.params.id) : undefined;
  const saved = await formsService.saveData(req.db!, req.tenantId!, {
    formType: req.params.type!,
    entityType: req.body.entityType,
    entityId: req.body.entityId ?? entityId,
    data: req.body.data,
    userId: req.user?.id,
  });
  res.json(saved);
});

// `:id` is the entity id (the NCR/CAPA/... row this form is attached to) across
// every route in this module, matching what a frontend "Open Form" button has
// on hand — not form_data's own internal id. These two resolve it first.

export const createVersion = asyncHandler(async (req: Request, res: Response) => {
  const current = await formsService.loadData(req.db!, req.tenantId!, req.params.type!, Number(req.params.id));
  if (!current) throw AppError.notFound("Form");
  const updated = await formsService.createVersion(req.db!, req.tenantId!, current.id, req.user?.id);

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
    req.tenantId!,
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
    req.tenantId!,
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
  const current = await formsService.loadData(req.db!, req.tenantId!, req.params.type!, Number(req.params.id));
  if (!current) throw AppError.notFound("Form");
  res.json(await formsService.listVersions(req.db!, req.tenantId!, current.id));
});

export const exportForm = asyncHandler(async (req: Request, res: Response) => {
  const entityId = req.params.id ? Number(req.params.id) : undefined;
  const pdfBytes = await formsService.exportPdf(req.db!, req.tenantId!, req.params.type!, entityId);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${req.params.type}-${entityId ?? "form"}.pdf"`);
  res.send(Buffer.from(pdfBytes));
});
