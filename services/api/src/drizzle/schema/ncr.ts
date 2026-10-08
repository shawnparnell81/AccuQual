import { pgTable, serial, text, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { suppliers } from "./supplier.js";
import { sites } from "./sites.js";

export const ncr = pgTable("ncr", {
  id: serial("id").primaryKey(),
  /** Company record number. Blank until someone types it. Never filled from this id. */
  recordNumber: text("record_number"),
  // Plant this issue belongs to. Nullable in the type so inserts that omit
  // it still compile; the database column is NOT NULL and a BEFORE INSERT
  // trigger fills the company's default plant when the caller doesn't (see
  // 0070_sites.sql). Request creates stamp the current plant explicitly.
  siteId: integer("site_id").references(() => sites.id),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("ncr_created"), // ncr_created, contain, disposition, fix, verify, closed
  severity: text("severity"), // low, medium, high, critical
  containment: text("containment"),
  rootCause: text("root_cause"),
  correctiveAction: text("corrective_action"),
  assignedTo: integer("assigned_to").references(() => users.id),
  createdBy: integer("created_by").references(() => users.id),
  // a real, direct supplier link (previously NCR had none at
  // all — every prior "which NCRs belong to this supplier" query had to
  // derive it indirectly via RMA/warranty/supplier-portal CAR/8D links, see
  // supplier-portal/supplierLinkage.ts). Set automatically when an NCR is
  // auto-created from a rejected/quarantined receiving inspection (see
  // erp/receivingAutomation.ts), and settable by hand otherwise. Real FK —
  // ncr.ts has no import cycle with supplier.ts.
  supplierId: integer("supplier_id").references(() => suppliers.id),
  // Deliberately NOT a real FK (would create an ncr.ts <-> erp.ts import
  // cycle, since erp.ts already imports ncr.ts for its own linkedNcrId) —
  // same "free-form reference, not a foreign key" convention
  // inventory_movements.referenceId already uses for the same reason.
  receivingLineItemId: integer("receiving_line_item_id"),
  // Real due date — added so NCR can appear on the Calendar/Workflow Inbox
  // with an honest date instead of always showing "No due date" (there was
  // no due-date concept on this table before).
  dueDate: timestamp("due_date"),
  closedAt: timestamp("closed_at"),
  // Process stage for the NCR Process workflow. The six-step record status stays in `status`.
  workflowStage: text("workflow_stage"),
  processData: jsonb("process_data").$type<Record<string, unknown>>(),
  slaTargetDate: timestamp("sla_target_date"),
  slaDueDate: timestamp("sla_due_date"),
  slaStatus: text("sla_status"),
  slaWarningSent: boolean("sla_warning_sent").notNull().default(false),
  slaEscalated: boolean("sla_escalated").notNull().default(false),
  stageDueDate: timestamp("stage_due_date"),
  daysOpen: integer("days_open"),
  daysInStage: integer("days_in_stage"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const ncrAttachments = pgTable("ncr_attachments", {
  id: serial("id").primaryKey(),
  ncrId: integer("ncr_id").references(() => ncr.id).notNull(),
  fileUrl: text("file_url").notNull(),
  uploadedBy: integer("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Ncr = typeof ncr.$inferSelect;
export type NewNcr = typeof ncr.$inferInsert;
