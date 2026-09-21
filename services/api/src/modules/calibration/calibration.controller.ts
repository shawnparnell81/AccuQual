import type { Request, Response } from "express";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { equipment, calibrations, type Calibration } from "../../drizzle/schema/calibration.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { hasPermission } from "../../middleware/requirePermission.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import type { TenantDb } from "../../lib/tenantScope.js";
import * as service from "./calibration.service.js";

export const baseHandlers = crudFactory(equipment, { entityName: "Equipment", idColumn: "id" });

/**
 * Full-System Audit finding H2 — equipment's own baseHandlers.remove was
 * never mounted at all. Mounting it as-is would work for a never-calibrated
 * item but throw a raw, unhandled Postgres foreign-key violation (a 500
 * exposing internal DB error text) for the much more common real case: an
 * item with real calibration history, since calibrations.equipmentId is a
 * NOT NULL FK with no ON DELETE CASCADE (see drizzle/schema/calibration.ts —
 * deliberately not cascaded, so calibration history is never silently lost
 * just because the equipment record itself is removed later). This guard
 * turns that into the same kind of clean, explained 400 every other
 * business-rule delete/edit guard in this app already gives (e.g. CRAR's
 * "completed and can no longer be edited" check) instead of a crash.
 */
export const removeEquipmentHandler = asyncHandler(async (req: Request, res: Response, next) => {
  const equipmentId = Number(req.params.id);
  const existing = await req.db!.select({ id: calibrations.id }).from(calibrations).where(and(eq(calibrations.equipmentId, equipmentId), eq(calibrations.tenantId, req.tenantId!))).limit(1);
  if (existing.length > 0) {
    throw AppError.badRequest("This equipment has recorded calibration history and cannot be deleted. Remove its calibration records first if it must go.");
  }
  return baseHandlers.remove(req, res, next);
});

/**
 * Equipment list, each row carrying where it stands: its latest finished calibration, next due date, a due status computed HERE
 * (overdue / due_soon / upcoming / current / uncalibrated / failed) and any open scheduled calibration. The 60/30-day colour bands
 * the pages draw are the same thresholds; computing them on the server as well is what lets a digest, an alert and a workflow
 * see the same answer the screen shows.
 */
export const listWithStatus = asyncHandler(async (req: Request, res: Response) => {
  res.json(await service.listEquipmentWithSummary(req.db!, req.tenantId!));
});

export const getEquipmentHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await service.getEquipmentWithSummary(req.db!, req.tenantId!, Number(req.params.id)));
});

export interface CalibrationEventInput {
  performedAt: Date;
  result?: string;
  technicianName?: string;
  notes?: string;
}

/**
 * The one place a finished calibration gets recorded — used by both the direct API (addCalibrationHandler below) and the
 * "Calibration Record" form save hook (forms.controller.ts), so the two can never drift into recording events differently.
 * Completes the equipment's scheduled calibration when there is one; a failed result takes the equipment out of service and a
 * passing one returns it (see calibration.service.ts).
 */
export async function createCalibrationEvent(db: TenantDb, tenantId: number, equipmentId: number, input: CalibrationEventInput, performedBy?: number): Promise<Calibration> {
  return service.recordCompletedCalibration(db, tenantId, equipmentId, input, performedBy);
}

export const addCalibrationHandler = asyncHandler(async (req: Request, res: Response) => {
  const equipmentId = Number(req.params.id);
  const body = req.body as { scheduledAt?: Date; performedAt?: Date; result?: string; results?: Record<string, unknown>; technicianName?: string; notes?: string };
  if (body.performedAt) {
    const calibration = await service.recordCompletedCalibration(req.db!, req.tenantId!, equipmentId, { performedAt: body.performedAt, result: body.result, results: body.results, technicianName: body.technicianName, notes: body.notes }, req.user?.id);
    return void res.status(201).json(calibration);
  }
  const scheduled = await service.scheduleCalibration(req.db!, req.tenantId!, equipmentId, { scheduledAt: body.scheduledAt!, notes: body.notes }, req.user?.id);
  res.status(201).json(scheduled);
});

export const completeCalibrationHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { performedAt?: Date; result: "pass" | "fail" | "adjusted"; results?: Record<string, unknown>; technicianName?: string; notes?: string };
  const done = await service.completeCalibration(req.db!, req.tenantId!, Number(req.params.calibrationId), { performedAt: body.performedAt ?? new Date(), result: body.result, results: body.results, technicianName: body.technicianName, notes: body.notes }, req.user?.id);
  res.json(done);
});

export const cancelScheduleHandler = asyncHandler(async (req: Request, res: Response) => {
  await service.cancelScheduledCalibration(req.db!, req.tenantId!, Number(req.params.calibrationId), req.user?.id);
  res.status(204).send();
});

export const changeStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const { status, reason } = req.body as { status: "active" | "inactive" | "out_of_service"; reason?: string };
  const override = await hasPermission(req.db!, req.tenantId!, req.user!, "equipment.override");
  const updated = await service.changeEquipmentStatus(req.db!, req.tenantId!, Number(req.params.id), status, { reason, canOverride: override.allowed }, req.user?.id);
  res.json(updated);
});

export const attentionHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await service.attention(req.db!, req.tenantId!));
});

export const notifyDueHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await service.notifyDue(req.db!, req.tenantId!));
});

export const listCalibrationsHandler = asyncHandler(async (req: Request, res: Response) => {
  const items = await req
    .db!.select()
    .from(calibrations)
    .where(and(eq(calibrations.equipmentId, Number(req.params.id)), eq(calibrations.tenantId, req.tenantId!)));
  res.json(items);
});

/**
 * Attaches a real uploaded file to a calibration event — replaces the old
 * free-text certificateUrl field. Same multer memoryStorage + PDF-only +
 * STORAGE_LOCAL_PATH convention as document-folders.controller.ts's
 * uploadTemplate, just scoped to calibration certificates instead.
 */
export const uploadCertificateHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const calibrationId = Number(req.params.calibrationId);
  const file = req.file;
  if (!file) throw AppError.badRequest("No file uploaded");
  if (file.mimetype !== "application/pdf") throw AppError.badRequest("Only PDF files are accepted");

  const [calibration] = await req.db!.select().from(calibrations).where(and(eq(calibrations.id, calibrationId), eq(calibrations.tenantId, tenantId)));
  if (!calibration) throw AppError.notFound("Calibration event");

  const dir = `${env.STORAGE_LOCAL_PATH}/tenants/${tenantId}/forms/custom/calibration-certs`;
  await mkdir(dir, { recursive: true });
  const path = `${dir}/${calibrationId}-${Date.now()}.pdf`;
  await writeFile(path, file.buffer);

  if (calibration.certificatePath && existsSync(calibration.certificatePath)) {
    await unlink(calibration.certificatePath).catch((err) => logger.warn(`Could not remove replaced certificate file ${calibration.certificatePath}`, err));
  }

  const [updated] = await req.db!.update(calibrations).set({ certificatePath: path }).where(and(eq(calibrations.id, calibrationId), eq(calibrations.tenantId, tenantId))).returning();

  // Was missing entirely (see the Outputs Dictionary) — createCalibrationEvent
  // logs the event itself, but attaching/replacing a certificate afterwards
  // left no trace. entityType "Equipment" matches every other calibration
  // audit entry, scoped by equipmentId rather than the calibration row.
  await recordAuditTrail(req.db!, {
    tenantId,
    entityType: "Equipment",
    entityId: calibration.equipmentId,
    action: "update",
    changes: { action: "upload_certificate", calibrationId, filename: file.originalname },
    performedBy: req.user?.id,
  });

  res.status(201).json(updated);
});

/** Streams the attached certificate back for viewing/download. */
export const downloadCertificateHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const calibrationId = Number(req.params.calibrationId);

  const [calibration] = await req.db!.select().from(calibrations).where(and(eq(calibrations.id, calibrationId), eq(calibrations.tenantId, tenantId)));
  if (!calibration) throw AppError.notFound("Calibration event");
  if (!calibration.certificatePath || !existsSync(calibration.certificatePath)) throw AppError.notFound("Certificate file");

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="calibration-${calibrationId}-certificate.pdf"`);
  createReadStream(calibration.certificatePath).pipe(res);
});
