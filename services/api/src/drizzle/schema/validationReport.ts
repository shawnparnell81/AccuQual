import { pgTable, serial, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Validation Reports folder records.
 * `data.formType` is "csa", "fuel_pump", or "air_strut".
 * Missing formType stays the CSA report. `data.cells` holds the filled cells.
 * `authorizedSignature` is written only by the PIN sign route.
 */
export const validationReports = pgTable("validation_reports", {
  id: serial("id").primaryKey(),
  data: jsonb("data").$type<{ formType?: "csa" | "fuel_pump" | "air_strut"; cells?: Record<string, string | number | boolean | null>; authorizedSignature?: string }>().default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type ValidationReport = typeof validationReports.$inferSelect;
export type NewValidationReport = typeof validationReports.$inferInsert;
