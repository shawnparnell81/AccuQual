import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { digitalTwinModels, digitalTwinSimulations, iotData, iotDevices } from "../../drizzle/schema/digitalTwin.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { runSimulation, type TwinModel } from "./simulation-engine.js";
import { publishEvent, DIGITAL_TWIN_STREAM } from "../../lib/eventBus.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";

export const baseHandlers = crudFactory(digitalTwinModels, { entityName: "Digital twin model", idColumn: "id" });

/** Example Digital Twin Controller — mirrors the AccuQual Digital Twin Spec §6. */
export const simulateDigitalTwin = asyncHandler(async (req: Request, res: Response) => {
  const { modelId, parameters } = req.body;

  const [model] = await req
    .db!.select()
    .from(digitalTwinModels)
    .where(and(eq(digitalTwinModels.id, modelId), eq(digitalTwinModels.tenantId, req.tenantId!)));
  if (!model) throw AppError.notFound("Digital twin model");

  const results = runSimulation(model.modelJson as unknown as TwinModel, parameters);

  const [saved] = await req
    .db!.insert(digitalTwinSimulations)
    .values({ tenantId: req.tenantId!, modelId, inputParameters: parameters, results: results as unknown as Record<string, unknown> })
    .returning();

  // Was previously unaudited — model creation gets this for free via
  // crudFactory, but this handler bypasses that factory entirely.
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "DigitalTwinSimulation", entityId: saved!.id, action: "create", changes: { modelId }, performedBy: req.user?.id });

  res.json(saved);
});

export const getSimulation = asyncHandler(async (req: Request, res: Response) => {
  const [row] = await req
    .db!.select()
    .from(digitalTwinSimulations)
    .where(and(eq(digitalTwinSimulations.id, Number(req.params.id)), eq(digitalTwinSimulations.tenantId, req.tenantId!)));
  if (!row) throw AppError.notFound("Simulation");
  res.json(row);
});

/** Real-time IoT ingestion — persisted for time-series analysis and pushed to the digital-twin worker. */
export const ingestIot = asyncHandler(async (req: Request, res: Response) => {
  const { deviceId, timestamp, data } = req.body;
  const tenantId = req.tenantId!;

  await req.db!.insert(iotDevices).values({ tenantId, deviceId, lastSeenAt: new Date() }).onConflictDoUpdate({
    target: [iotDevices.tenantId, iotDevices.deviceId],
    set: { lastSeenAt: new Date() },
  });

  const [reading] = await req
    .db!.insert(iotData)
    .values({ tenantId, deviceId, timestamp: timestamp ?? new Date(), data })
    .returning();

  await publishEvent(DIGITAL_TWIN_STREAM, { event: "iot_reading", tenantId, deviceId, data });

  res.status(201).json(reading);
});

export const listDevicesHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await req.db!.select().from(iotDevices).where(eq(iotDevices.tenantId, req.tenantId!)));
});

/**
 * Real device registration — distinct from ingestIot's upsert, which only
 * ever sets deviceId+lastSeenAt as a side effect of a reading arriving.
 * This is the one real path that ever sets name/type/digitalTwinModelId.
 */
export const registerDeviceHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const { deviceId, name, type, digitalTwinModelId } = req.body as { deviceId: string; name?: string; type?: string; digitalTwinModelId?: number };

  if (digitalTwinModelId !== undefined) {
    const [model] = await req.db!.select().from(digitalTwinModels).where(and(eq(digitalTwinModels.id, digitalTwinModelId), eq(digitalTwinModels.tenantId, tenantId)));
    if (!model) throw AppError.notFound("Digital twin model");
  }

  const [device] = await req
    .db!.insert(iotDevices)
    .values({ tenantId, deviceId, name, type, digitalTwinModelId })
    .onConflictDoUpdate({ target: [iotDevices.tenantId, iotDevices.deviceId], set: { name, type, digitalTwinModelId } })
    .returning();

  await recordAuditTrail(req.db!, { tenantId, entityType: "IotDevice", entityId: device!.id, action: "create", changes: { deviceId, name, type, digitalTwinModelId }, performedBy: req.user?.id });
  res.status(201).json(device);
});
