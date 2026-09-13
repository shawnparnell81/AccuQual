import { z } from "zod";

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
  timestamp: z.coerce.date().optional(),
  data: z.record(z.string(), z.unknown()),
});

/** Real registration (name/type/model link) — /iot-ingest only ever upserts deviceId+lastSeenAt as a side effect of a reading, never these fields. */
export const registerDeviceSchema = z.object({
  deviceId: z.string().min(1),
  name: z.string().optional(),
  type: z.enum(["plc", "sensor", "inspection_equipment", "environmental"]).optional(),
  digitalTwinModelId: z.number().int().optional(),
});
