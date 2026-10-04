import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { suppliers } from "./supplier.js";
import { ncr } from "./ncr.js";
import { workflowDefinitions, workflowRuns } from "./workflow.js";
import { sites } from "./sites.js";

/**
 * Complete Strut Assembly first articles. New tables only.
 * Existing first-article plans, NCR rows, and workflow tables are not altered.
 */
export const csaFaiCounters = pgTable("csa_fai_counters", {
  year: integer("year").primaryKey(),
  lastValue: integer("last_value").notNull(),
});

export const csaFaiRecords = pgTable("csa_fai_records", {
  id: serial("id").primaryKey(),
  number: text("number").notNull().unique(),
  partNumber: text("part_number").notNull(),
  partDescription: text("part_description").notNull(),
  supplierName: text("supplier_name").notNull(),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  supplierPartNumber: text("supplier_part_number").notNull(),
  sampleLotNumber: text("sample_lot_number").notNull(),
  vehicleYear: text("vehicle_year").notNull(),
  vehicleMake: text("vehicle_make").notNull(),
  vehicleModel: text("vehicle_model").notNull(),
  position: text("position").notNull(),
  inspectorName: text("inspector_name").notNull(),
  inspectorUserId: integer("inspector_user_id").references(() => users.id),
  openedBy: integer("opened_by").references(() => users.id),
  dateOpened: timestamp("date_opened").notNull(),
  status: text("status").notNull(),
  stage: text("stage").notNull(),
  productFamily: text("product_family").notNull(),
  productionRelease: text("production_release").notNull().default("No"),
  approvedSupplier: text("approved_supplier").notNull().default("No"),
  ncrRequired: text("ncr_required").notNull().default("No"),
  failureDetected: text("failure_detected").notNull().default("No"),
  ncrId: integer("ncr_id").references(() => ncr.id),
  workflowId: integer("workflow_id").references(() => workflowDefinitions.id),
  workflowRunId: integer("workflow_run_id").references(() => workflowRuns.id),
  attemptNumber: integer("attempt_number").notNull().default(1),
  locked: text("locked").notNull().default("No"),
  slaStatus: text("sla_status"),
  rejectionReason: text("rejection_reason"),
  rejectedBy: text("rejected_by"),
  rejectionDate: timestamp("rejection_date"),
  approvalDate: timestamp("approval_date"),
  approvedBy: integer("approved_by").references(() => users.id),
  dateClosed: timestamp("date_closed"),
  siteId: integer("site_id").references(() => sites.id),
  packet: jsonb("packet").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type CsaFaiRecord = typeof csaFaiRecords.$inferSelect;
