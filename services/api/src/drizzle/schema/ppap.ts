import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * A PPAP (Production Part Approval Process) package for one part — the
 * container the Appearance Approval, APQP Summary, Control Plan, Dimensional
 * Report, and Process Flow Diagram forms all attach to via form_data's
 * entityType "ppap" + entityId, the same way a CAPA form attaches to a capa row.
 */
export const ppapPackages = pgTable("ppap_packages", {
  id: serial("id").primaryKey(),
  partNumber: text("part_number").notNull(),
  partName: text("part_name"),
  customer: text("customer"),
  status: text("status").notNull().default("open"), // open, submitted, approved, rejected
  ownerId: integer("owner_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export type PpapPackage = typeof ppapPackages.$inferSelect;
