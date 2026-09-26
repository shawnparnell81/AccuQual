import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const complaints = pgTable("complaints", {
  id: serial("id").primaryKey(),
  customerName: text("customer_name"),
  productAffected: text("product_affected"),
  description: text("description").notNull(),
  severity: text("severity"),
  status: text("status").notNull().default("open"), // open, investigating, resolved, closed
  linkedNcrId: integer("linked_ncr_id"),
  assignedTo: integer("assigned_to").references(() => users.id),
  // What was found and how it was resolved — required to move to "resolved".
  resolution: text("resolution"),
  resolvedAt: timestamp("resolved_at"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type Complaint = typeof complaints.$inferSelect;
