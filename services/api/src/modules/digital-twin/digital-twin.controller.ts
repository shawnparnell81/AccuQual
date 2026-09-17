import type { Request, Response } from "express";
import { and, eq, sql } from "drizzle-orm";
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

  // COALESCE against `excluded` (Postgres's name for the row this insert
  // attempted) rather than the bare `name`/`type`/`digitalTwinModelId`
  // variables directly: registering an already-known device with those
  // three fields left blank — the most obvious way to use this form — used
  // to build a `set` object of nothing but `undefined`s, which Drizzle
  // rejects with "No values to set" (found live, QA sweep review). This
  // keeps every existing value in place when a field isn't provided, and
  // still updates it when one is, while `set` itself always has real keys.
  const [device] = await req
    .db!.insert(iotDevices)
    .values({ tenantId, deviceId, name, type, digitalTwinModelId })
    .onConflictDoUpdate({
      target: [iotDevices.tenantId, iotDevices.deviceId],
      set: {
        name: sql`coalesce(excluded.name, ${iotDevices.name})`,
        type: sql`coalesce(excluded.type, ${iotDevices.type})`,
        digitalTwinModelId: sql`coalesce(excluded.digital_twin_model_id, ${iotDevices.digitalTwinModelId})`,
      },
    })
    .returning();

  await recordAuditTrail(req.db!, { tenantId, entityType: "IotDevice", entityId: device!.id, action: "create", changes: { deviceId, name, type, digitalTwinModelId }, performedBy: req.user?.id });
  res.status(201).json(device);
});

async function loadDevice(req: Request, id: number) {
  const [row] = await req.db!.select().from(iotDevices).where(and(eq(iotDevices.id, id), eq(iotDevices.tenantId, req.tenantId!)));
  if (!row) throw AppError.notFound("IoT device");
  return row;
}

/**
 * Real edit-by-id — previously the only way to change a device's
 * name/type/model link was to re-POST the same deviceId and rely on
 * registerDeviceHandler's upsert (a working but undiscoverable path with no
 * frontend UI for it). This is the standard PATCH-by-id shape every other
 * resource in this app already uses (see digitalTwinRouter's own
 * PATCH /models/:id above), and the only one that can actually clear a
 * field back to null (the upsert's COALESCE-against-excluded logic can only
 * ever keep-or-replace, never clear).
 */
export const updateDeviceHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const record = await loadDevice(req, Number(req.params.id));
  const { digitalTwinModelId } = req.body as { digitalTwinModelId?: number | null };

  if (digitalTwinModelId) {
    const [model] = await req.db!.select().from(digitalTwinModels).where(and(eq(digitalTwinModels.id, digitalTwinModelId), eq(digitalTwinModels.tenantId, tenantId)));
    if (!model) throw AppError.notFound("Digital twin model");
  }

  const [updated] = await req.db!.update(iotDevices).set(req.body).where(eq(iotDevices.id, record.id)).returning();
  await recordAuditTrail(req.db!, { tenantId, entityType: "IotDevice", entityId: record.id, action: "update", changes: req.body, performedBy: req.user?.id });
  res.json(updated);
});

/**
 * Real deletion — previously impossible entirely (no route existed). Safe
 * to hard-delete: iot_data's own deviceId column is a plain string, not an
 * FK to this table (see digitalTwin.ts's schema comment), so removing a
 * device row never cascades into or orphans its historical readings.
 */
export const deleteDeviceHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.tenantId!;
  const record = await loadDevice(req, Number(req.params.id));
  await req.db!.delete(iotDevices).where(eq(iotDevices.id, record.id));
  await recordAuditTrail(req.db!, { tenantId, entityType: "IotDevice", entityId: record.id, action: "delete", changes: { deviceId: record.deviceId }, performedBy: req.user?.id });
  res.status(204).send();
});
