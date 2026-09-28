import { pgTable, serial, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Validation Reports folder records.
 * `data.formType` is "csa" (FRM-VAL-001) or "fuel_pump" (FRM-VAL-007).
 * Missing formType stays the CSA report. `data.cells` holds the filled cells.
 */
export const validationReports = pgTable("validation_reports", {
  id: serial("id").primaryKey(),
  data: jsonb("data").$type<{ formType?: "csa" | "fuel_pump"; cells?: Record<string, string | number | boolean | null> }>().default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type ValidationReport = typeof validationReports.$inferSelect;
export type NewValidationReport = typeof validationReports.$inferInsert;
