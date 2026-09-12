import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const equipment = pgTable("equipment", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  serialNumber: text("serial_number"),
  location: text("location"),
  calibrationIntervalDays: integer("calibration_interval_days").notNull().default(365),
  createdAt: timestamp("created_at").defaultNow(),
});

export const calibrations = pgTable("calibrations", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  equipmentId: integer("equipment_id").references(() => equipment.id).notNull(),
  performedAt: timestamp("performed_at").notNull(),
  performedBy: integer("performed_by"),
  result: text("result"), // pass, fail, adjusted
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
