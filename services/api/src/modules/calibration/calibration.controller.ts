import type { Request, Response } from "express";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { equipment, calibrations, type Calibration } from "../../drizzle/schema/calibration.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import type { TenantDb } from "../../lib/tenantScope.js";

export const baseHandlers = crudFactory(equipment, { entityName: "Equipment", idColumn: "id" });

/**
 * Equipment list, each row carrying its most recent calibration's due date.
 * The 60/30-day-warning and past-due status itself is computed client-side
 * (apps/web's formulas.ts, shared with the FMEA/calibration form layouts) —
 * this just resolves the one fact the client can't derive on its own: which
 * calibration record is the latest one for that equipment.
 */
export const listWithStatus = asyncHandler(async (req: Request, res: Response) => {
  const items = await req.db!.select().from(equipment).where(eq(equipment.tenantId, req.tenantId!));
  const cals = await req.db!.select().from(calibrations).where(eq(calibrations.tenantId, req.tenantId!));

  const latestByEquipment = new Map<number, Calibration>();
  for (const c of cals) {
    const current = latestByEquipment.get(c.equipmentId);
    if (!current || new Date(c.performedAt) > new Date(current.performedAt)) latestByEquipment.set(c.equipmentId, c);
  }

  const withStatus = items.map((item) => {
    const latest = latestByEquipment.get(item.id);
    return {
      ...item,
      lastCalibratedAt: latest?.performedAt ?? null,
      nextDueAt: latest?.nextDueAt ?? null,
      lastResult: latest?.result ?? null,
    };
  });

  res.json(withStatus);
});

export interface CalibrationEventInput {
  performedAt: Date;
  result?: string;
  technicianName?: string;
  notes?: string;
}

/**
 * The one place a calibration event gets created — used by both the direct
 * API (addCalibrationHandler below) and the "Calibration Record" form save
 * hook (forms.controller.ts), so the two can never drift into recording
 * events differently. Recomputes nextDueAt from the equipment's own
 * calibrationIntervalDays (the live status color on the list/detail pages
 * is derived from that, computed at read time — nothing to keep in sync)
 * and appends an audit trail entry for every event, not just equipment edits.
 */
export async function createCalibrationEvent(
  db: TenantDb,
  tenantId: number,
  equipmentId: number,
  input: CalibrationEventInput,
  performedBy?: number
): Promise<Calibration> {
  const [item] = await db.select().from(equipment).where(and(eq(equipment.id, equipmentId), eq(equipment.tenantId, tenantId)));
  if (!item) throw AppError.notFound("Equipment");

  const nextDueAt = new Date(input.performedAt);
  nextDueAt.setDate(nextDueAt.getDate() + item.calibrationIntervalDays);

  const [calibration] = await db
    .insert(calibrations)
    .values({
      tenantId,
      equipmentId,
      performedAt: input.performedAt,
      result: input.result,
      technicianName: input.technicianName,
      notes: input.notes,
      performedBy,
      nextDueAt,
    })
    .returning();
  if (!calibration) throw new AppError("Failed to record calibration event", 500);

  // "create" is the closest fit in audit_trail's fixed action enum (see
  // audit-trail.service.ts) — the specifics live in `changes`, same as every
  // other module's audit entries.
  await recordAuditTrail(db, {
    tenantId,
    entityType: "Equipment",
    entityId: equipmentId,
    action: "create",
    changes: { calibrationId: calibration.id, technicianName: input.technicianName, result: input.result, nextDueAt },
    performedBy,
  });

  return calibration;
}

export const addCalibrationHandler = asyncHandler(async (req: Request, res: Response) => {
  const equipmentId = Number(req.params.id);
  // validate(addCalibrationSchema) already coerced performedAt to a real Date.
  const { performedAt, result, technicianName, notes } = req.body as { performedAt: Date; result?: string; technicianName?: string; notes?: string };
  const calibration = await createCalibrationEvent(req.db!, req.tenantId!, equipmentId, { performedAt, result, technicianName, notes }, req.user?.id);
  res.status(201).json(calibration);
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
