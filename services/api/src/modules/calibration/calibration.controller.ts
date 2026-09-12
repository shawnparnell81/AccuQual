import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { equipment, calibrations, type Calibration } from "../../drizzle/schema/calibration.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";

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

export const addCalibrationHandler = asyncHandler(async (req: Request, res: Response) => {
  const equipmentId = Number(req.params.id);
  const [item] = await req.db!.select().from(equipment).where(and(eq(equipment.id, equipmentId), eq(equipment.tenantId, req.tenantId!)));
  if (!item) throw AppError.notFound("Equipment");

  const performedAt = new Date(req.body.performedAt);
  const nextDueAt = new Date(performedAt);
  nextDueAt.setDate(nextDueAt.getDate() + item.calibrationIntervalDays);

  const [calibration] = await req
    .db!.insert(calibrations)
    .values({ ...req.body, performedAt, equipmentId, tenantId: req.tenantId!, performedBy: req.user?.id, nextDueAt })
    .returning();
  res.status(201).json(calibration);
});

export const listCalibrationsHandler = asyncHandler(async (req: Request, res: Response) => {
  const items = await req
    .db!.select()
    .from(calibrations)
    .where(and(eq(calibrations.equipmentId, Number(req.params.id)), eq(calibrations.tenantId, req.tenantId!)));
  res.json(items);
});
