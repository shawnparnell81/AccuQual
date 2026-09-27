import { pgTable, serial, text, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/** One uploaded file and the import that ran (or is running) from it. */
export const dataImports = pgTable("data_imports", {
  id: serial("id").primaryKey(),
  entityKey: text("entity_key").notNull(),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  /** uploaded | checking | checked | running | completed | failed */
  status: text("status").notNull().default("uploaded"),
  /** skip: import the good rows. fail: import nothing if any row is bad. */
  badRowMode: text("bad_row_mode").notNull().default("skip"),
  /** skip | update | create_only */
  duplicateMode: text("duplicate_mode").notNull().default("skip"),
  sendInvites: boolean("send_invites").notNull().default(false),
  mapping: jsonb("mapping").$type<Record<string, number | null>>(),
  totalRows: integer("total_rows").notNull().default(0),
  processedRows: integer("processed_rows").notNull().default(0),
  createdCount: integer("created_count").notNull().default(0),
  updatedCount: integer("updated_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  headers: jsonb("headers").$type<string[]>(),
  sample: jsonb("sample").$type<string[][]>(),
  /** The first problems, for the on-screen list. The full list is the error CSV. */
  problems: jsonb("problems").$type<{ row: number; label: string; messages: string[] }[]>(),
  errorReportPath: text("error_report_path"),
  message: text("message"),
  startedBy: integer("started_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export type DataImport = typeof dataImports.$inferSelect;
export type NewDataImport = typeof dataImports.$inferInsert;
