import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { tenants } from "./tenants.js";

export const ncr = pgTable("ncr", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"), // open, contained, investigating, corrective_action, closed
  severity: text("severity"), // low, medium, high, critical
  containment: text("containment"),
  rootCause: text("root_cause"),
  correctiveAction: text("corrective_action"),
  assignedTo: integer("assigned_to").references(() => users.id),
  createdBy: integer("created_by").references(() => users.id),
  closedAt: timestamp("closed_at"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const ncrAttachments = pgTable("ncr_attachments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  ncrId: integer("ncr_id").references(() => ncr.id).notNull(),
  fileUrl: text("file_url").notNull(),
  uploadedBy: integer("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Ncr = typeof ncr.$inferSelect;
export type NewNcr = typeof ncr.$inferInsert;
