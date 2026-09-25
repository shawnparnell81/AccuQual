import type { Request, Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { digitalTwinModels, digitalTwinSimulations, iotData, iotDevices } from "../../drizzle/schema/digitalTwin.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { runSimulation, type TwinModel } from "./simulation-engine.js";
import { publishEvent, DIGITAL_TWIN_STREAM } from "../../lib/eventBus.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { aiRiskScores } from "../../drizzle/schema/ai.js";
import { db as rootDb } from "../../db/index.js";
import { generateDeviceKey, parseDeviceKey, deviceSecretMatches } from "./digital-twin.deviceKeys.js";

/**
 * A device as the API returns it: never the key hash (not reversible, but
 * there's no reason to hand it to every user in the tenant — device GETs are
 * open to all of them), just whether a key has been issued.
 */
function publicDevice(row: typeof iotDevices.$inferSelect) {
  const { apiKeyHash, ...rest } = row;
  return { ...rest, hasApiKey: Boolean(apiKeyHash) };
}

export const baseHandlers = crudFactory(digitalTwinModels, { entityName: "Digital twin model", idColumn: "id" });

/** Example Digital Twin Controller — mirrors the AccuQual Digital Twin Spec §6. */
export const simulateDigitalTwin = asyncHandler(async (req: Request, res: Response) => {
  const { modelId, parameters } = req.body;

  const [model] = await req
    .db!.select()
    .from(digitalTwinModels)
    .where(and(eq(digitalTwinModels.id, modelId)));
  if (!model) throw AppError.notFound("Digital twin model");

  const results = runSimulation(model.modelJson as unknown as TwinModel, parameters);

  const [saved] = await req
    .db!.insert(digitalTwinSimulations)
    .values({ modelId, inputParameters: parameters, results: results as unknown as Record<string, unknown> })
    .returning();

  // Was previously unaudited — model creation gets this for free via
  // crudFactory, but this handler bypasses that factory entirely.
  await recordAuditTrail(req.db!, { entityType: "DigitalTwinSimulation", entityId: saved!.id, action: "create", changes: { modelId }, performedBy: req.user?.id });

  res.json(saved);
});

export const getSimulation = asyncHandler(async (req: Request, res: Response) => {
  const [row] = await req
    .db!.select()
    .from(digitalTwinSimulations)
    .where(and(eq(digitalTwinSimulations.id, Number(req.params.id))));
  if (!row) throw AppError.notFound("Simulation");
  res.json(row);
});

/** Real-time IoT ingestion — persisted for time-series analysis and pushed to the digital-twin worker. */
export const ingestIot = asyncHandler(async (req: Request, res: Response) => {
  const { deviceId, timestamp, data } = req.body;

  await req.db!.insert(iotDevices).values({ deviceId, lastSeenAt: new Date() }).onConflictDoUpdate({
    target: iotDevices.deviceId,
    set: { lastSeenAt: new Date() },
  });

  const [reading] = await req
    .db!.insert(iotData)
    .values({ deviceId, timestamp: timestamp ?? new Date(), data })
    .returning();

  await publishEvent(DIGITAL_TWIN_STREAM, { event: "iot_reading", deviceId, data });

  res.status(201).json(reading);
});

export const listDevicesHandler = asyncHandler(async (req: Request, res: Response) => {
  const devices = await req.db!.select().from(iotDevices);
  res.json(devices.map(publicDevice));
});

/**
 * Real device registration — distinct from ingestIot's upsert, which only
 * ever sets deviceId+lastSeenAt as a side effect of a reading arriving.
 * This is the one real path that ever sets name/type/digitalTwinModelId.
 */
export const registerDeviceHandler = asyncHandler(async (req: Request, res: Response) => {
  const { deviceId, name, type, digitalTwinModelId } = req.body as { deviceId: string; name?: string; type?: string; digitalTwinModelId?: number };

  if (digitalTwinModelId !== undefined) {
    const [model] = await req.db!.select().from(digitalTwinModels).where(and(eq(digitalTwinModels.id, digitalTwinModelId)));
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
    .values({ deviceId, name, type, digitalTwinModelId })
    .onConflictDoUpdate({
      target: iotDevices.deviceId,
      set: {
        name: sql`coalesce(excluded.name, ${iotDevices.name})`,
        type: sql`coalesce(excluded.type, ${iotDevices.type})`,
        digitalTwinModelId: sql`coalesce(excluded.digital_twin_model_id, ${iotDevices.digitalTwinModelId})`,
      },
    })
    .returning();

  await recordAuditTrail(req.db!, { entityType: "IotDevice", entityId: device!.id, action: "create", changes: { deviceId, name, type, digitalTwinModelId }, performedBy: req.user?.id });
  res.status(201).json(publicDevice(device!));
});

async function loadDevice(req: Request, id: number) {
  const [row] = await req.db!.select().from(iotDevices).where(and(eq(iotDevices.id, id)));
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
  const record = await loadDevice(req, Number(req.params.id));
  const { digitalTwinModelId } = req.body as { digitalTwinModelId?: number | null };

  if (digitalTwinModelId) {
    const [model] = await req.db!.select().from(digitalTwinModels).where(and(eq(digitalTwinModels.id, digitalTwinModelId)));
    if (!model) throw AppError.notFound("Digital twin model");
  }

  const [updated] = await req.db!.update(iotDevices).set(req.body).where(eq(iotDevices.id, record.id)).returning();
  await recordAuditTrail(req.db!, { entityType: "IotDevice", entityId: record.id, action: "update", changes: req.body, performedBy: req.user?.id });
  res.json(publicDevice(updated!));
});

/**
 * Real deletion — previously impossible entirely (no route existed). Safe
 * to hard-delete: iot_data's own deviceId column is a plain string, not an
 * FK to this table (see digitalTwin.ts's schema comment), so removing a
 * device row never cascades into or orphans its historical readings.
 */
export const deleteDeviceHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadDevice(req, Number(req.params.id));
  await req.db!.delete(iotDevices).where(eq(iotDevices.id, record.id));
  await recordAuditTrail(req.db!, { entityType: "IotDevice", entityId: record.id, action: "delete", changes: { deviceId: record.deviceId }, performedBy: req.user?.id });
  res.status(204).send();
});

/**
 * Drift alerts the digital-twin worker recorded (driftDetection.ts) — until
 * now written to ai_risk_scores and never readable anywhere. Newest first,
 * with the device's registered name joined in when there is one.
 */
export const listAlertsHandler = asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const rows = await req
    .db!.select()
    .from(aiRiskScores)
    .where(and(eq(aiRiskScores.entityType, "iot_device")))
    .orderBy(desc(aiRiskScores.createdAt))
    .limit(limit);
  const devices = await req.db!.select().from(iotDevices);
  const nameByDeviceId = new Map(devices.map((d) => [d.deviceId, d.name]));

  res.json(
    rows.map((r) => {
      const details = (r.details ?? {}) as Record<string, unknown>;
      const deviceId = typeof details.deviceId === "string" ? details.deviceId : null;
      return {
        id: r.id,
        deviceId,
        deviceName: deviceId ? (nameByDeviceId.get(deviceId) ?? null) : null,
        channel: typeof details.channel === "string" ? details.channel : null,
        reading: typeof details.reading === "number" ? details.reading : null,
        baseline: typeof details.runningMean === "number" ? details.runningMean : null,
        direction: typeof details.direction === "string" ? details.direction : null,
        score: r.score === null ? null : Number(r.score),
        createdAt: r.createdAt,
      };
    })
  );
});

/**
 * Issues (or replaces) a device's ingest key. The plain key is returned ONCE
 * in this response and never stored — only its SHA-256 is — so a lost key
 * means rotating again, and rotating instantly invalidates the old one.
 */
export const rotateDeviceKeyHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadDevice(req, Number(req.params.id));
  const { apiKey, hash } = generateDeviceKey(record.id);
  await req.db!.update(iotDevices).set({ apiKeyHash: hash, apiKeyCreatedAt: new Date() }).where(eq(iotDevices.id, record.id));
  await recordAuditTrail(req.db!, { entityType: "IotDevice", entityId: record.id, action: "update", changes: { action: "api_key_rotated" }, performedBy: req.user?.id });
  res.status(201).json({ apiKey, deviceId: record.deviceId });
});

export const revokeDeviceKeyHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadDevice(req, Number(req.params.id));
  await req.db!.update(iotDevices).set({ apiKeyHash: null, apiKeyCreatedAt: null }).where(eq(iotDevices.id, record.id));
  await recordAuditTrail(req.db!, { entityType: "IotDevice", entityId: record.id, action: "update", changes: { action: "api_key_revoked" }, performedBy: req.user?.id });
  res.status(204).send();
});

/**
 * Device-authenticated ingest (POST /digital-twin/device-ingest, no user
 * session): a PLC/sensor sends its key in X-Device-Key. The tenant and
 * deviceId come from the device's OWN row, never the request body, so a
 * device can only ever write to itself. Uses the unscoped connection (there
 * is no tenant context before the key is verified — same reason login does)
 * and always writes an explicit tenantId.
 */
export const deviceIngestHandler = asyncHandler(async (req: Request, res: Response) => {
  const parsed = parseDeviceKey(req.header("x-device-key"));
  const [device] = parsed ? await rootDb.select().from(iotDevices).where(eq(iotDevices.id, parsed.deviceRowId)) : [];
  if (!parsed || !device || !device.apiKeyHash || !deviceSecretMatches(parsed.secret, device.apiKeyHash)) {
    throw AppError.unauthorized("Invalid device key");
  }

  const { timestamp, data } = req.body as { timestamp?: Date; data: Record<string, unknown> };
  await rootDb.update(iotDevices).set({ lastSeenAt: new Date() }).where(eq(iotDevices.id, device.id));
  const [reading] = await rootDb.insert(iotData).values({ deviceId: device.deviceId, timestamp: timestamp ?? new Date(), data }).returning();
  await publishEvent(DIGITAL_TWIN_STREAM, { event: "iot_reading", deviceId: device.deviceId, data });
  res.status(201).json({ id: reading!.id });
});
