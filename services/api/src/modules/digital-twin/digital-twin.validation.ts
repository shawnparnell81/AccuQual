import { z } from "zod";
import { reasonableDate } from "../../utils/validation.js";

const twinNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["machine", "process", "checkpoint", "operator"]),
  baseDefectRate: z.number().min(0).max(1).optional(),
  throughputPerHour: z.number().positive().optional(),
});

export const modelJsonSchema = z.object({
  nodes: z.array(twinNodeSchema),
  edges: z.array(z.object({ from: z.string(), to: z.string() })),
});

export const createModelSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  modelJson: modelJsonSchema,
});

export const updateModelSchema = createModelSchema.partial();

export const simulateSchema = z.object({
  modelId: z.number().int(),
  parameters: z
    .object({
      iterations: z.number().int().positive().optional(),
      demandPerHour: z.number().positive().optional(),
      driftFactor: z.number().positive().optional(),
    })
    .default({}),
});

export const iotIngestSchema = z.object({
  deviceId: z.string().min(1),
  timestamp: reasonableDate.optional(),
  data: z.record(z.string(), z.unknown()),
});

/** Real registration (name/type/model link) — /iot-ingest only ever upserts deviceId+lastSeenAt as a side effect of a reading, never these fields. */
export const registerDeviceSchema = z.object({
  deviceId: z.string().min(1),
  name: z.string().optional(),
  type: z.enum(["plc", "sensor", "inspection_equipment", "environmental"]).optional(),
  digitalTwinModelId: z.number().int().optional(),
});

/**
 * Editing an already-registered device by its real row id — deliberately
 * excludes `deviceId` (the company-unique identifier a real physical device
 * reports readings under; changing it here would silently orphan every
 * existing iot_data reading still tagged with the old value, since that
 * table has no FK to this one — see digitalTwin.ts's schema comment).
 * `digitalTwinModelId: null` explicitly unlinks a device from its model.
 */
export const updateDeviceSchema = z.object({
  name: z.string().nullable().optional(),
  type: z.enum(["plc", "sensor", "inspection_equipment", "environmental"]).nullable().optional(),
  digitalTwinModelId: z.number().int().nullable().optional(),
});

/**
 * Body of the device-authenticated ingest endpoint. Unlike /iot-ingest, no
 * deviceId here: the device is identified by its X-Device-Key alone, so a
 * device can never write a reading under a different device's id. Payload
 * size is capped since this endpoint is reachable without a user login.
 */
export const deviceIngestSchema = z.object({
  timestamp: reasonableDate.optional(),
  data: z.record(z.string(), z.unknown()).refine((d) => JSON.stringify(d).length <= 16_384, { message: "Reading payload is too large (16 KB max)" }),
});
