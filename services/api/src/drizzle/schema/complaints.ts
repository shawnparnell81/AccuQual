import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { tenants } from "./tenants.js";

export const complaints = pgTable("complaints", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  customerName: text("customer_name"),
  productAffected: text("product_affected"),
  description: text("description").notNull(),
  severity: text("severity"),
  status: text("status").notNull().default("open"), // open, investigating, resolved, closed
  linkedNcrId: integer("linked_ncr_id"),
  assignedTo: integer("assigned_to").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type Complaint = typeof complaints.$inferSelect;
