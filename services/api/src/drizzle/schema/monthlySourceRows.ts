import { integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/** One upload of a monthly source spreadsheet. summary: kinds found, rows per month, rows added/updated/removed. */
export const monthlySourceUploads = pgTable("monthly_source_uploads", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
  uploadedBy: integer("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

/** One row of a monthly source spreadsheet, filed under the month of its own date. */
export const monthlySourceRows = pgTable(
  "monthly_source_rows",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    rowKey: text("row_key").notNull(),
    /** YYYY-MM from the row's own date. */
    month: text("month").notNull(),
    data: jsonb("data").$type<Record<string, string | number | null>>().notNull().default({}),
    uploadId: integer("upload_id").references(() => monthlySourceUploads.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    sourceKey: uniqueIndex("monthly_source_rows_source_key_uq").on(table.source, table.rowKey),
  }),
);

/** A verified month: its raw rows are gone, these per-month totals stay for later months' trends. */
export const monthlySourceMonths = pgTable("monthly_source_months", {
  month: text("month").primaryKey(),
  figures: jsonb("figures").$type<Record<string, unknown>>().notNull().default({}),
  verifiedBy: integer("verified_by").references(() => users.id),
  verifiedAt: timestamp("verified_at").notNull().defaultNow(),
});
