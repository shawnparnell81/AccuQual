import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Validation Reports folder records.
 * `data.formType` selects the sheet. Missing formType stays the CSA report.
 * `data.cells` holds the filled cells.
 * Signature fields are written only by the PIN sign route.
 */
export const validationReports = pgTable("validation_reports", {
  id: serial("id").primaryKey(),
  recordNumber: text("record_number"),
  data: jsonb("data")
    .$type<{
      formType?:
        | "csa"
        | "fuel_pump"
        | "air_strut"
        | "air_spring"
        | "fuel_injector"
        | "brake_wear"
        | "shock"
        | "air_compressor"
        | "electric_lift"
        | "gas_lift"
        | "coil_spring";
      cells?: Record<string, string | number | boolean | null>;
      authorizedSignature?: string;
      furtherSignature?: string;
      /** NCRs opened from a failed validation. The NCR number stays blank until someone types it. */
      linkedNcrs?: { id: number }[];
    }>()
    .default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type ValidationReport = typeof validationReports.$inferSelect;
export type NewValidationReport = typeof validationReports.$inferInsert;
