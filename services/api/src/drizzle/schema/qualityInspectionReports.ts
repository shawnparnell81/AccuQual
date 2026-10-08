import { pgTable, serial, text, integer, timestamp, numeric, jsonb } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { suppliers } from "./supplier.js";
import { erpReceivingLineItems } from "./erp.js";

/**
 * Header fields do not match the simple-form engine, so this table is its own.
 * The checklist is addable, so rows live in `qualityInspectionItems`.
 */
export const qualityInspectionReports = pgTable("quality_inspection_reports", {
  id: serial("id").primaryKey(),
  recordNumber: text("record_number"),
  inspectionDate: timestamp("inspection_date"),
  inspectorName: text("inspector_name"),
  inspectionType: text("inspection_type"), // incoming | in_process | final
  partMaterialNo: text("part_material_no"),
  poJobNo: text("po_job_no"),
  supplierVendor: text("supplier_vendor"),
  batchLotNo: text("batch_lot_no"),
  totalQuantity: text("total_quantity"),
  sampleSize: text("sample_size"),
  finalStatus: text("final_status"), // accepted | rejected | rework_required | accepted_via_deviation
  // real FK/structured fields added ALONGSIDE the free-text ones
  // above (supplierVendor/poJobNo/batchLotNo stay as-is, never repurposed,
  // for backward compatibility with every report entered before this
  // phase): supplierId/receivingLineItemId let a receiving inspection
  // actually join back to the real supplier/PO/receiving record it was
  // performed against, instead of a human-typed name/number a report and
  // its receiving document could silently disagree on.
  supplierId: integer("supplier_id").references(() => suppliers.id),
  receivingLineItemId: integer("receiving_line_item_id").references(() => erpReceivingLineItems.id),
  defectCategory: text("defect_category"),
  inspectionMethod: text("inspection_method"), // visual | dimensional | functional | documentation | other
  notesRemarks: text("notes_remarks"),
  inspectorSignature: text("inspector_signature"),
  inspectorSignatureDate: timestamp("inspector_signature_date"),
  qaLeadSignature: text("qa_lead_signature"),
  qaLeadSignatureDate: timestamp("qa_lead_signature_date"),
  signatureRequired: jsonb("signature_required").$type<Record<string, "yes" | "no">>(),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

/** The mockup's "Inspection Checklist & Measured Results" table — a real, freely-addable set of rows. */
export const qualityInspectionItems = pgTable("quality_inspection_items", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id").references(() => qualityInspectionReports.id).notNull(),
  itemNumber: numeric("item_number"),
  parameter: text("parameter"),
  specification: text("specification"),
  actualFinding: text("actual_finding"),
  result: text("result"), // pass | fail
  // real numeric measurement fields alongside the free-text
  // specification/actualFinding above (kept as-is: a spec is often prose,
  // e.g. "per drawing rev C", not always a numeric range) — filled in only
  // when the checklist row actually has a measurable numeric result.
  specMin: numeric("spec_min"),
  specMax: numeric("spec_max"),
  actualValue: numeric("actual_value"),
  measurementUnit: text("measurement_unit"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type QualityInspectionReport = typeof qualityInspectionReports.$inferSelect;
export type QualityInspectionItem = typeof qualityInspectionItems.$inferSelect;
