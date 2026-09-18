import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { ncr } from "./ncr.js";
import { users } from "./users.js";
import { tenants } from "./tenants.js";
import { suppliers } from "./supplier.js";

export const capa = pgTable("capa", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  ncrId: integer("ncr_id").references(() => ncr.id),
  rootCause: text("root_cause"),
  actionPlan: text("action_plan"),
  preventiveAction: text("preventive_action"),
  verification: text("verification"),
  status: text("status").notNull().default("open"), // open, in_progress, verifying, closed
  ownerId: integer("owner_id").references(() => users.id),
  verifiedBy: integer("verified_by").references(() => users.id),
  verifiedAt: timestamp("verified_at"),
  // Phase 8 — set when this CAPA was auto-created by receivingAutomation.ts's
  // recurrence check (see erp/receivingAutomation.ts's own comment), rather
  // than created by hand. Null for every ordinary CAPA. Not an enum at the
  // DB level — today's only real value is "receiving_recurrence", but this
  // stays a plain text escape hatch the way every other "source" tag in
  // this app is (referenceType, etc.), not a fixed list to migrate later.
  escalationSource: text("escalation_source"),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  // Real due date — same reasoning as ncr.ts's own dueDate column: there
  // was no due-date concept on this table before, so it always showed
  // "No due date" on the Calendar/Workflow Inbox.
  dueDate: timestamp("due_date"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type Capa = typeof capa.$inferSelect;
export type NewCapa = typeof capa.$inferInsert;
