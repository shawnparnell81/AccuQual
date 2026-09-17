import { pgTable, serial, text, integer, timestamp, numeric } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";
import { suppliers } from "./supplier.js";
import { erpReceivingLineItems } from "./erp.js";

/**
 * Quality Inspection Report — the second of the two forms reported as real
 * gaps in the "ACCUQUAL Forms" batch review (see accuqual-qms-forms-batch
 * memory's "Inspection Forms" gap), now supplied as a real HTML mockup.
 * Built bespoke rather than on the generic QMS Simple Form engine for the
 * same reason as ScarForm — its header fields don't match that engine's
 * fixed shape — but its "Inspection Checklist & Measured Results" section
 * IS a real freely-addable table (unlike SCAR's fixed-row sections), so it
 * gets a real child table (qualityInspectionItems), the same pattern
 * DocumentChangeRequest's own child tables use.
 */
export const qualityInspectionReports = pgTable("quality_inspection_reports", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
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
  // Phase 8 — real FK/structured fields added ALONGSIDE the free-text ones
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
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

/** The mockup's "Inspection Checklist & Measured Results" table — a real, freely-addable set of rows. */
export const qualityInspectionItems = pgTable("quality_inspection_items", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  reportId: integer("report_id").references(() => qualityInspectionReports.id).notNull(),
  itemNumber: numeric("item_number"),
  parameter: text("parameter"),
  specification: text("specification"),
  actualFinding: text("actual_finding"),
  result: text("result"), // pass | fail
  // Phase 8 — real numeric measurement fields alongside the free-text
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
