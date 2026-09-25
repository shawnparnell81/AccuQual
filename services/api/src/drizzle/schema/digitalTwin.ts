import { pgTable, serial, text, integer, timestamp, jsonb, unique } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const digitalTwinModels = pgTable("digital_twin_models", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  modelJson: jsonb("model_json").$type<Record<string, unknown>>().notNull(), // machines, processes, flow
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const digitalTwinSimulations = pgTable("digital_twin_simulations", {
  id: serial("id").primaryKey(),
  modelId: integer("model_id").references(() => digitalTwinModels.id).notNull(),
  inputParameters: jsonb("input_parameters").$type<Record<string, unknown>>(),
  results: jsonb("results").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * IoT time-series readings. In production this table is converted to a
 * TimescaleDB hypertable via `SELECT create_hypertable('iot_data', 'timestamp');`
 * (see migrations/0002_timescale_hypertables.sql).
 */
export const iotData = pgTable("iot_data", {
  id: serial("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  timestamp: timestamp("timestamp").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>(), // sensor readings
});

export const iotDevices = pgTable(
  "iot_devices",
  {
    id: serial("id").primaryKey(),
    // Device IDs are only guaranteed unique within a tenant, not globally
    // (two tenants' shop floors can both have a "sensor-1").
    deviceId: text("device_id").notNull(),
    name: text("name"),
    type: text("type"), // plc, sensor, inspection_equipment, environmental
    digitalTwinModelId: integer("digital_twin_model_id").references(() => digitalTwinModels.id),
    lastSeenAt: timestamp("last_seen_at"),
    // SHA-256 of the device's ingest secret (never the secret itself) — lets a
    // real PLC/sensor authenticate with an X-Device-Key header instead of a
    // user's short-lived login token. See digital-twin.deviceKeys.ts.
    apiKeyHash: text("api_key_hash"),
    apiKeyCreatedAt: timestamp("api_key_created_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [unique("iot_devices_device_unique").on(table.deviceId)]
);

export type DigitalTwinModel = typeof digitalTwinModels.$inferSelect;
export type DigitalTwinSimulation = typeof digitalTwinSimulations.$inferSelect;
export type IotData = typeof iotData.$inferSelect;
export type IotDevice = typeof iotDevices.$inferSelect;
