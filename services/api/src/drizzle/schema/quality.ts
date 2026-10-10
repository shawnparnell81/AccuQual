import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { audits, auditItems } from "./audits.js";

/**
 * Discrepancy & Inspection investigations — the "Quality" folder's own
 * record type, backing formType "discrepancy_inspection". A row is opened
 * when someone chooses Create investigation / NCR on an audit item, or
 * starts one with no audit link. Adding an audit item never inserts one.
 */
export const discrepancyInvestigations = pgTable("discrepancy_investigations", {
  id: serial("id").primaryKey(),
  recordNumber: text("record_number"),
  title: text("title").notNull(),
  description: text("description"),
  severity: text("severity"), // minor, major, critical
  status: text("status").notNull().default("open"), // open, investigating, disposed, closed
  disposition: text("disposition"), // use-as-is, rework, repair, scrap, return-to-supplier, sort
  autoCreated: boolean("auto_created").notNull().default(false),
  sourceAuditId: integer("source_audit_id").references(() => audits.id),
  sourceAuditItemId: integer("source_audit_item_id").references(() => auditItems.id),
  assignedTo: integer("assigned_to").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type DiscrepancyInvestigation = typeof discrepancyInvestigations.$inferSelect;
