import { pgTable, serial, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * CSA Validation Report (FRM-VAL-001). `data.cells` holds the filled cells.
 * Pass/fail cells are calculated in the form from those values.
 */
export const validationReports = pgTable("validation_reports", {
  id: serial("id").primaryKey(),
  data: jsonb("data").$type<{ cells?: Record<string, string | number | boolean | null> }>().default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type ValidationReport = typeof validationReports.$inferSelect;
export type NewValidationReport = typeof validationReports.$inferInsert;
