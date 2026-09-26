import { pgTable, serial, text, integer, timestamp, jsonb, bigint } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users.js";

/** Immutable, append-only change history across every module (cross-cutting concern). */
export const auditTrail = pgTable("audit_trail", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(), // ncr, capa, audits, documents, ...
  entityId: integer("entity_id").notNull(),
  action: text("action").notNull(), // create, update, delete, status_change
  changes: jsonb("changes").$type<Record<string, unknown>>(),
  performedBy: integer("performed_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  // Postgres transaction id — shared with the audit_row_changes rows the same request wrote, which is how a history entry finds its field-level old/new values.
  txid: bigint("txid", { mode: "number" }).default(sql`txid_current()`),
});

export type AuditTrailEntry = typeof auditTrail.$inferSelect;
