import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { tenants } from "./tenants.js";

/** Immutable, append-only change history across every module (cross-cutting concern). */
export const auditTrail = pgTable("audit_trail", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  entityType: text("entity_type").notNull(), // ncr, capa, audits, documents, ...
  entityId: integer("entity_id").notNull(),
  action: text("action").notNull(), // create, update, delete, status_change
  changes: jsonb("changes").$type<Record<string, unknown>>(),
  performedBy: integer("performed_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AuditTrailEntry = typeof auditTrail.$inferSelect;
