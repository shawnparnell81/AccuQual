import { pgTable, serial, text, integer, timestamp, numeric } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";
import { inventoryItems } from "./inventory.js";
import { ncr } from "./ncr.js";

/**
 * A real, standalone production Work Order — the only "work order" that
 * existed anywhere in AccuQual before this was a printable PDF-style form
 * (`form_data`, formType "maintenance_work_order") for *equipment*
 * maintenance tickets: an unstructured jsonb blob meant for filling and
 * printing, not a queryable record. This table is the genuine production-
 * planning entity AI Work Order Planning needs to read and write against —
 * built because there was nothing real to build the AI feature on top of
 * (see the AI Work Order Planning / PR Justification / Onboarding / ERP
 * Automation review).
 *
 * status: planned | in_progress | completed | cancelled
 *
 * Completing a work order logs a real `inventory_movements` row
 * (movement_type "produce") via inventory.service.ts's existing movement
 * path, tagging referenceType="work_order"/referenceId=String(id) — both
 * are free-form text fields on that table already (see inventory.ts's own
 * comment on why they were left manual), not a new FK relationship.
 */
export const workOrders = pgTable("work_orders", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  itemId: integer("item_id").references(() => inventoryItems.id).notNull(),
  quantityPlanned: numeric("quantity_planned").notNull(),
  quantityCompleted: numeric("quantity_completed").notNull().default("0"),
  status: text("status").notNull().default("planned"),
  linkedNcrId: integer("linked_ncr_id").references(() => ncr.id),
  dueDate: timestamp("due_date"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type WorkOrder = typeof workOrders.$inferSelect;
export type NewWorkOrder = typeof workOrders.$inferInsert;
