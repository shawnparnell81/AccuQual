import { boolean, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users.js";

/**
 * One Quality / Engineering monthly report (the TMP-ENG-001 pack: executive
 * summary, supplier warranty charts, and the narrative around NCR, quarantine,
 * and first article). Dollar totals come from Labor Claims and Warranty claims.
 */
export const qualityEngineeringReports = pgTable(
  "quality_engineering_reports",
  {
    id: serial("id").primaryKey(),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    narrative: jsonb("narrative").$type<Record<string, unknown>>().notNull().default({}),
    supplierData: jsonb("supplier_data").$type<Record<string, unknown>>().notNull().default({}),
    /** Email addresses that receive this saved report. Empty until someone adds them. */
    recipients: jsonb("recipients").$type<string[]>().notNull().default([]),
    uploadFileName: text("upload_file_name"),
    createdBy: integer("created_by").references(() => users.id),
    updatedBy: integer("updated_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at"),
    /** Soft delete, like other records. A deleted month keeps its row but is read as empty, and a fresh report can take its place. */
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at"),
    deletedBy: integer("deleted_by").references(() => users.id),
  },
  (table) => ({
    // One live report per month. A soft-deleted month does not hold the month.
    yearMonth: uniqueIndex("quality_engineering_reports_year_month_uq")
      .on(table.year, table.month)
      .where(sql`${table.isDeleted} = false`),
  }),
);

export type QualityEngineeringReportRow = typeof qualityEngineeringReports.$inferSelect;
