import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users.js";
import { suppliers } from "./supplier.js";
import { ncr } from "./ncr.js";
import { sites } from "./sites.js";

/** FAI & Inspection module (Phase 1). New tables only; the retired fai_* tables are untouched. */

export const inspPlans = pgTable("insp_plans", {
  id: serial("id").primaryKey(),
  partNumber: text("part_number").notNull(),
  partDescription: text("part_description"),
  productFamily: text("product_family"),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  supplierFactory: text("supplier_factory"),
  receivingLocation: text("receiving_location"),
  riskClass: text("risk_class").notNull().default("Major"),
  revision: integer("revision").notNull().default(1),
  status: text("status").notNull().default("Draft"),
  repeatIntervalMonths: integer("repeat_interval_months").notNull().default(6),
  majorAql: text("major_aql").notNull().default("1.0"),
  minorAql: text("minor_aql").notNull().default("2.5"),
  notes: text("notes"),
  siteId: integer("site_id").references(() => sites.id),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const inspPlanCharacteristics = pgTable("insp_plan_characteristics", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id")
    .references(() => inspPlans.id)
    .notNull(),
  revision: integer("revision").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
  name: text("name").notNull(),
  charType: text("char_type").notNull().default("Major"),
  limitType: text("limit_type").notNull().default("plus_minus"),
  nominal: text("nominal"),
  tolerancePlus: text("tolerance_plus"),
  toleranceMinus: text("tolerance_minus"),
  percent: text("percent"),
  specMin: text("spec_min"),
  specMax: text("spec_max"),
  unit: text("unit"),
  method: text("method"),
});

export const inspApprovedSources = pgTable(
  "insp_approved_sources",
  {
    id: serial("id").primaryKey(),
    partNumber: text("part_number").notNull(),
    supplierId: integer("supplier_id").references(() => suppliers.id),
    supplierFactory: text("supplier_factory"),
    receivingLocation: text("receiving_location"),
    status: text("status").notNull().default("not_approved"),
    lastFaiDate: text("last_fai_date"),
    lastResult: text("last_result"),
    nextDueDate: text("next_due_date"),
    lastFaiId: integer("last_fai_id"),
    siteId: integer("site_id").references(() => sites.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => ({
    partSupplierFactoryLocation: uniqueIndex("insp_approved_sources_unique_idx").on(
      table.partNumber,
      table.supplierId,
      table.supplierFactory,
      table.receivingLocation,
    ),
  }),
);

export const inspRecords = pgTable("insp_records", {
  id: serial("id").primaryKey(),
  faiNumber: text("fai_number").notNull().unique(),
  planId: integer("plan_id").references(() => inspPlans.id),
  planRevision: integer("plan_revision"),
  partNumber: text("part_number").notNull(),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  supplierFactory: text("supplier_factory"),
  receivingLocation: text("receiving_location"),
  triggerReason: text("trigger_reason"),
  poReference: text("po_reference"),
  lotSize: integer("lot_size"),
  sampleSize: integer("sample_size"),
  inspector: text("inspector"),
  datePulled: text("date_pulled"),
  dateLabReceived: text("date_lab_received"),
  dateInspected: text("date_inspected"),
  status: text("status").notNull().default("draft"),
  overallResult: text("overall_result"),
  comments: text("comments"),
  inspectionLevel: text("inspection_level").notNull().default("II"),
  severity: text("severity").notNull().default("Normal"),
  majorAql: text("major_aql"),
  minorAql: text("minor_aql"),
  codeLetter: text("code_letter"),
  aqlSampleSize: integer("aql_sample_size"),
  acMajor: integer("ac_major"),
  reMajor: integer("re_major"),
  acMinor: integer("ac_minor"),
  reMinor: integer("re_minor"),
  linkedCsaFaiId: integer("linked_csa_fai_id"),
  linkedFuelPumpFaiId: integer("linked_fuel_pump_fai_id"),
  ncrId: integer("ncr_id").references(() => ncr.id),
  siteId: integer("site_id").references(() => sites.id),
  signedBy: integer("signed_by").references(() => users.id),
  signedAt: timestamp("signed_at"),
  signature: text("signature"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const inspResultLines = pgTable("insp_result_lines", {
  id: serial("id").primaryKey(),
  recordId: integer("record_id")
    .references(() => inspRecords.id)
    .notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  characteristicName: text("characteristic_name").notNull(),
  charType: text("char_type").notNull().default("Major"),
  limitType: text("limit_type").notNull().default("plus_minus"),
  nominal: text("nominal"),
  tolerancePlus: text("tolerance_plus"),
  toleranceMinus: text("tolerance_minus"),
  percent: text("percent"),
  specMin: text("spec_min"),
  specMax: text("spec_max"),
  unit: text("unit"),
  method: text("method"),
  limitLow: text("limit_low"),
  limitHigh: text("limit_high"),
  measuredValue: text("measured_value"),
  attributeResult: text("attribute_result"),
  result: text("result"),
  defects: integer("defects").notNull().default(0),
});

/**
 * The code each sample tag carries (<FAI number>-S<n>) and how often it was printed. A tag label, not an inventory record:
 * AccuQual keeps no stock, quantity on hand or transfers. Rows go with their FAI record.
 */
export const inspRecordSamples = pgTable(
  "insp_record_samples",
  {
    id: serial("id").primaryKey(),
    recordId: integer("record_id")
      .references(() => inspRecords.id, { onDelete: "cascade" })
      .notNull(),
    sampleNumber: integer("sample_number").notNull(),
    code: text("code").notNull(),
    printedCount: integer("printed_count").notNull().default(0),
    lastPrintedAt: timestamp("last_printed_at", { withTimezone: true }),
    lastPrintedBy: integer("last_printed_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    recordNumber: uniqueIndex("insp_record_samples_record_number_uq").on(table.recordId, table.sampleNumber),
    codeUnique: uniqueIndex("insp_record_samples_code_uq").on(sql`lower(${table.code})`),
  }),
);

export type InspPlan = typeof inspPlans.$inferSelect;
export type InspPlanCharacteristic = typeof inspPlanCharacteristics.$inferSelect;
export type InspApprovedSource = typeof inspApprovedSources.$inferSelect;
export type InspRecord = typeof inspRecords.$inferSelect;
export type InspResultLine = typeof inspResultLines.$inferSelect;
