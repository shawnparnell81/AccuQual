import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { suppliers } from "./supplier.js";
import { ncr } from "./ncr.js";
import { workflowDefinitions, workflowRuns } from "./workflow.js";

/**
 * Fuel Pump Module first articles. New tables only.
 * Existing first-article plans, NCR rows, and workflow tables are not altered.
 */
export const fuelPumpFaiCounters = pgTable("fuel_pump_fai_counters", {
  year: integer("year").primaryKey(),
  lastValue: integer("last_value").notNull(),
});

export const fuelPumpFaiRecords = pgTable("fuel_pump_fai_records", {
  id: serial("id").primaryKey(),
  faiNumber: text("fai_number").notNull().unique(),
  partNumber: text("part_number").notNull(),
  partDescription: text("part_description").notNull().default(""),
  supplier: text("supplier").notNull(),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  supplierPartNumber: text("supplier_part_number").notNull().default(""),
  sampleLotNumber: text("sample_lot_number").notNull(),
  vehicleYear: text("vehicle_year").notNull().default(""),
  vehicleMake: text("vehicle_make").notNull().default(""),
  vehicleModel: text("vehicle_model").notNull().default(""),
  vehicleEngine: text("vehicle_engine").notNull().default(""),
  application: text("application").notNull(),
  inspector: text("inspector").notNull(),
  inspectorUserId: integer("inspector_user_id").references(() => users.id),
  validationOwner: text("validation_owner").notNull().default(""),
  qualityManager: text("quality_manager").notNull().default(""),
  openedBy: integer("opened_by").references(() => users.id),
  status: text("status").notNull(),
  workflowStage: text("workflow_stage").notNull(),
  overallResult: text("overall_result"),
  flowRateResult: text("flow_rate_result"),
  pressureResult: text("pressure_result"),
  currentDrawResult: text("current_draw_result"),
  electricalResult: text("electrical_result"),
  fitmentResult: text("fitment_result"),
  packagingResult: text("packaging_result"),
  failureDetected: text("failure_detected").notNull().default("No"),
  ncrRequired: text("ncr_required").notNull().default("No"),
  linkedNcr: integer("linked_ncr").references(() => ncr.id),
  productionRelease: text("production_release").notNull().default("No"),
  dateOpened: timestamp("date_opened").notNull(),
  dateClosed: timestamp("date_closed"),
  slaStatus: text("sla_status"),
  workflowId: integer("workflow_id").references(() => workflowDefinitions.id),
  workflowRunId: integer("workflow_run_id").references(() => workflowRuns.id),
  attemptNumber: integer("attempt_number").notNull().default(1),
  locked: text("locked").notNull().default("No"),
  rejectionReason: text("rejection_reason"),
  rejectedBy: text("rejected_by"),
  rejectionDate: timestamp("rejection_date"),
  approvalDate: timestamp("approval_date"),
  approvedBy: integer("approved_by").references(() => users.id),
  packet: jsonb("packet").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type FuelPumpFaiRecord = typeof fuelPumpFaiRecords.$inferSelect;
