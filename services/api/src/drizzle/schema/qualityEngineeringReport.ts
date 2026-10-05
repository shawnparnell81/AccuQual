import { integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * One Quality / Engineering monthly report (the TMP-ENG-001 pack: executive
 * summary, supplier warranty charts, and the narrative around NCR, quarantine,
 * and first article). Supplier claim dollars are stored from an upload. They
 * are not copied out of the warranty module.
 */
export const qualityEngineeringReports = pgTable(
  "quality_engineering_reports",
  {
    id: serial("id").primaryKey(),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    narrative: jsonb("narrative").$type<Record<string, unknown>>().notNull().default({}),
    supplierData: jsonb("supplier_data").$type<Record<string, unknown>>().notNull().default({}),
    uploadFileName: text("upload_file_name"),
    createdBy: integer("created_by").references(() => users.id),
    updatedBy: integer("updated_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => ({
    yearMonth: uniqueIndex("quality_engineering_reports_year_month_uq").on(table.year, table.month),
  }),
);

export type QualityEngineeringReportRow = typeof qualityEngineeringReports.$inferSelect;
