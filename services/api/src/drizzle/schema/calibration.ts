import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const EQUIPMENT_STATUSES = ["active", "inactive", "out_of_service"] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];
export const CALIBRATION_STATUSES = ["scheduled", "completed", "failed"] as const;
export type CalibrationStatus = (typeof CALIBRATION_STATUSES)[number];

export const equipment = pgTable("equipment", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  serialNumber: text("serial_number"),
  location: text("location"),
  calibrationIntervalDays: integer("calibration_interval_days").notNull().default(365),
  // Kind of instrument ("caliper", "torque wrench", "scale", ...): free text so each organization keeps its own vocabulary.
  type: text("type"),
  // active: in use. inactive: retired / not in use. out_of_service: must not be used (failed calibration or pulled by hand).
  status: text("status").$type<EquipmentStatus>().notNull().default("active"),
  statusReason: text("status_reason"),
  // Why it is out of service: "calibration_failure" (a failed calibration put it there and a passing one returns it) or "manual".
  statusCause: text("status_cause"),
  statusChangedAt: timestamp("status_changed_at"),
  statusChangedBy: integer("status_changed_by").references(() => users.id),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

export const calibrations = pgTable("calibrations", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  equipmentId: integer("equipment_id").references(() => equipment.id).notNull(),
  // Null while the calibration is only scheduled; set when it is done.
  performedAt: timestamp("performed_at"),
  performedBy: integer("performed_by"),
  result: text("result"), // pass, fail, adjusted
  // scheduled -> completed | failed. Rows recorded before scheduling existed are completed (or failed when result = fail).
  status: text("status").$type<CalibrationStatus>().notNull().default("completed"),
  scheduledAt: timestamp("scheduled_at"),
  scheduledBy: integer("scheduled_by").references(() => users.id),
  completedAt: timestamp("completed_at"),
  // Readings / measurements taken during the calibration (free-form JSON).
  results: jsonb("results").$type<Record<string, unknown>>(),
  nextDueAt: timestamp("next_due_at"),
  // Kept for any pre-existing rows that already have a pasted-in link —
  // no longer written by the app; certificatePath (a real uploaded file,
  // same multer/STORAGE_LOCAL_PATH convention as Document Library
  // templates) replaces it going forward. See calibration.controller.ts.
  certificateUrl: text("certificate_url"),
  certificatePath: text("certificate_path"),
  technicianName: text("technician_name"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Equipment = typeof equipment.$inferSelect;
export type Calibration = typeof calibrations.$inferSelect;
