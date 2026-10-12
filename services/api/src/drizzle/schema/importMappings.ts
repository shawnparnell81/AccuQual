import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * A saved "Import from file" mapping: for one target, which source locator fed each
 * target field, so next month's file with the same labels matches without re-mapping.
 * Values are never stored here — only the rule + the label/heading text (or column) used.
 */
export type ImportMappingRule = "label" | "heading" | "tableRow" | "tableField" | "named" | "manual";

export interface ImportMappingEntry {
  rule: ImportMappingRule;
  /** A Phase 1 path-like locator or the label/heading text that was matched. */
  source: string;
  column?: string;
}

export const importMappings = pgTable("import_mappings", {
  id: serial("id").primaryKey(),
  targetRef: text("target_ref").notNull(),
  fileKind: text("file_kind").notNull(),
  name: text("name").notNull(),
  entries: jsonb("entries").$type<Record<string, ImportMappingEntry>>().notNull().default({}),
  createdBy: integer("created_by").references(() => users.id),
  updatedBy: integer("updated_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

export type ImportMapping = typeof importMappings.$inferSelect;
