import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { ncr } from "./ncr.js";
import { users } from "./users.js";
import { tenants } from "./tenants.js";

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
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type Capa = typeof capa.$inferSelect;
export type NewCapa = typeof capa.$inferInsert;
