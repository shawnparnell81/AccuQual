import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { sites } from "./sites.js";

export const audits = pgTable("audits", {
  id: serial("id").primaryKey(),
  // Same plant rule as ncr.siteId — omitted inserts land on the default plant.
  siteId: integer("site_id").references(() => sites.id),
  name: text("name").notNull(),
  type: text("type"), // internal, supplier, customer, certification
  auditorId: integer("auditor_id").references(() => users.id),
  status: text("status").notNull().default("scheduled"), // scheduled, in_progress, completed
  scheduledAt: timestamp("scheduled_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const auditItems = pgTable("audit_items", {
  id: serial("id").primaryKey(),
  auditId: integer("audit_id").references(() => audits.id).notNull(),
  question: text("question"),
  finding: text("finding"),
  severity: text("severity"), // minor, major, critical, observation
  evidence: text("evidence"),
  // Position in the checklist, set by drag-to-reorder. NULL means "never reordered": those sort by creation order, after any positioned items.
  sortOrder: integer("sort_order"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Audit = typeof audits.$inferSelect;
export type AuditItem = typeof auditItems.$inferSelect;
