import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { suppliers } from "./supplier.js";
import { ncr } from "./ncr.js";

/**
 * Reusable inspection plan. A new table only. Existing first-article blanks
 * stay on iso quality forms and are not written here.
 */
export const faiInspectionPlans = pgTable("fai_inspection_plans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  scope: text("scope").notNull(), // part | family
  partNumber: text("part_number"),
  partName: text("part_name"),
  productFamily: text("product_family"),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  cadenceMonths: integer("cadence_months").notNull().default(6),
  currentRevision: integer("current_revision").notNull().default(1),
  notes: text("notes"),
  retiredAt: timestamp("retired_at"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const faiPlanRevisions = pgTable(
  "fai_plan_revisions",
  {
    id: serial("id").primaryKey(),
    planId: integer("plan_id")
      .references(() => faiInspectionPlans.id)
      .notNull(),
    revision: integer("revision").notNull(),
    cadenceMonths: integer("cadence_months").notNull(),
    scope: text("scope").notNull(),
    partNumber: text("part_number"),
    productFamily: text("product_family"),
    supplierId: integer("supplier_id").references(() => suppliers.id),
    createdBy: integer("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    planRevision: uniqueIndex("fai_plan_revisions_plan_revision_idx").on(table.planId, table.revision),
  }),
);

export const faiPlanCharacteristics = pgTable("fai_plan_characteristics", {
  id: serial("id").primaryKey(),
  revisionId: integer("revision_id")
    .references(() => faiPlanRevisions.id)
    .notNull(),
  sortOrder: integer("sort_order").notNull(),
  balloon: text("balloon"),
  name: text("name").notNull(),
  mode: text("mode").notNull(), // percent_nominal | plus_minus | min_max | attribute
  nominal: text("nominal"),
  percent: text("percent"),
  plusTolerance: text("plus_tolerance"),
  minusTolerance: text("minus_tolerance"),
  specMin: text("spec_min"),
  specMax: text("spec_max"),
});

export const faiNumberCounters = pgTable("fai_number_counters", {
  year: integer("year").primaryKey(),
  lastValue: integer("last_value").notNull(),
});

export const faiRecords = pgTable("fai_records", {
  id: serial("id").primaryKey(),
  number: text("number").notNull().unique(),
  planId: integer("plan_id")
    .references(() => faiInspectionPlans.id)
    .notNull(),
  revisionId: integer("revision_id")
    .references(() => faiPlanRevisions.id)
    .notNull(),
  planRevision: integer("plan_revision").notNull(),
  partNumber: text("part_number").notNull(),
  partName: text("part_name"),
  supplierId: integer("supplier_id")
    .references(() => suppliers.id)
    .notNull(),
  supplierName: text("supplier_name").notNull(),
  status: text("status").notNull().default("open"), // open | submitted | approved | rejected
  comments: text("comments"),
  assignedTo: integer("assigned_to").references(() => users.id),
  openedBy: integer("opened_by").references(() => users.id),
  submittedBy: integer("submitted_by").references(() => users.id),
  submittedAt: timestamp("submitted_at"),
  decidedBy: integer("decided_by").references(() => users.id),
  decidedAt: timestamp("decided_at"),
  qualitySignature: text("quality_signature"),
  outcome: text("outcome"),
  ncrId: integer("ncr_id").references(() => ncr.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

/** Limits copied at open time. Plan edits after that do not update these rows. */
export const faiResultLines = pgTable("fai_result_lines", {
  id: serial("id").primaryKey(),
  faiId: integer("fai_id")
    .references(() => faiRecords.id)
    .notNull(),
  sortOrder: integer("sort_order").notNull(),
  balloon: text("balloon"),
  name: text("name").notNull(),
  mode: text("mode").notNull(),
  nominal: text("nominal"),
  percent: text("percent"),
  plusTolerance: text("plus_tolerance"),
  minusTolerance: text("minus_tolerance"),
  specMin: text("spec_min"),
  specMax: text("spec_max"),
  limitLow: text("limit_low"),
  limitHigh: text("limit_high"),
  actual: text("actual"),
  attributeResult: text("attribute_result"),
  result: text("result"),
});

export const faiSourceApprovals = pgTable(
  "fai_source_approvals",
  {
    id: serial("id").primaryKey(),
    partNumber: text("part_number").notNull(),
    supplierId: integer("supplier_id")
      .references(() => suppliers.id)
      .notNull(),
    supplierName: text("supplier_name").notNull(),
    status: text("status").notNull().default("pending"), // pending | approved | failed
    lastPassDate: text("last_pass_date"),
    nextDueDate: text("next_due_date"),
    cadenceMonths: integer("cadence_months").notNull().default(6),
    lastFaiId: integer("last_fai_id").references(() => faiRecords.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => ({
    partSupplier: uniqueIndex("fai_source_part_supplier_idx").on(table.partNumber, table.supplierId),
  }),
);

export const faiAnnualPulls = pgTable("fai_annual_pulls", {
  id: serial("id").primaryKey(),
  partNumber: text("part_number").notNull(),
  assignedTo: integer("assigned_to").references(() => users.id),
  assignedAt: timestamp("assigned_at"),
  completedAt: timestamp("completed_at"),
  completedBy: integer("completed_by").references(() => users.id),
  faiId: integer("fai_id").references(() => faiRecords.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type FaiInspectionPlan = typeof faiInspectionPlans.$inferSelect;
export type FaiPlanRevision = typeof faiPlanRevisions.$inferSelect;
export type FaiRecord = typeof faiRecords.$inferSelect;
export type FaiResultLine = typeof faiResultLines.$inferSelect;
export type FaiSourceApproval = typeof faiSourceApprovals.$inferSelect;
export type FaiAnnualPull = typeof faiAnnualPulls.$inferSelect;
