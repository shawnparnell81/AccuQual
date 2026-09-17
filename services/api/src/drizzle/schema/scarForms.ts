import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";
import { suppliers } from "./supplier.js";

/**
 * Supplier Corrective Action Request (SCAR) — one of the two forms reported
 * as real gaps in the "ACCUQUAL Forms" batch review (see
 * accuqual-qms-forms-batch memory), now supplied as a real HTML mockup and
 * built bespoke rather than on the generic QMS Simple Form engine: its
 * header fields (SCAR Number/Date Issued/Supplier Name/etc.) don't match
 * that engine's fixed Form No./Revision/Prepared By shape, its Root Cause
 * section is 5 single fields (not a table), and its CAPA/Sign-off sections
 * are FIXED-label rows (3 and 2 respectively, never user-addable) — so
 * they're flattened into plain columns here rather than a child table,
 * same reasoning DocumentChangeRequest used a real child table only where
 * the source document actually had a freely-addable table.
 *
 * status is NOT one of the source mockup's own fields (it has no
 * draft/active/obsolete concept) — added anyway (open/closed) as a small,
 * defensible interpretation call, matching every other real module in this
 * app having a real status to filter/list by; flagged to the user rather
 * than silently assumed away.
 */
export const scarForms = pgTable("scar_forms", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  scarNumber: text("scar_number"),
  dateIssued: timestamp("date_issued"),
  supplierName: text("supplier_name"),
  // Phase 7 — the free-text supplierName above predates any real link to
  // this app's own suppliers table; this nullable FK is added alongside it
  // (not a replacement) so existing SCARs and any future one still typed in
  // free-text both keep working, while a real supplier link lets the
  // Supplier Portal / internal Supplier Quality Risk Score actually query
  // "this supplier's SCARs" instead of fuzzy-matching a name string.
  supplierId: integer("supplier_id").references(() => suppliers.id),
  responseDueDate: timestamp("response_due_date"),
  contactPerson: text("contact_person"),
  poNumber: text("po_number"),
  partNumberDescription: text("part_number_description"),
  lotHeatNumber: text("lot_heat_number"),
  quantityInspected: text("quantity_inspected"),
  quantityRejected: text("quantity_rejected"),
  defectDescription: text("defect_description"),
  quarantineAtSupplier: boolean("quarantine_at_supplier").notNull().default(false),
  quarantineInTransit: boolean("quarantine_in_transit").notNull().default(false),
  quarantineAtCustomerSite: boolean("quarantine_at_customer_site").notNull().default(false),
  containmentPlan: text("containment_plan"),
  why1: text("why_1"),
  why2: text("why_2"),
  why3: text("why_3"),
  why4: text("why_4"),
  why5: text("why_5"),
  // CAPA plan — 3 fixed rows from the source mockup (Permanent Corrective Action / Preventive Action / Process-SOP Update), never user-addable.
  correctiveActionOwner: text("corrective_action_owner"),
  correctiveActionTargetDate: timestamp("corrective_action_target_date"),
  preventiveActionOwner: text("preventive_action_owner"),
  preventiveActionTargetDate: timestamp("preventive_action_target_date"),
  processUpdateOwner: text("process_update_owner"),
  processUpdateTargetDate: timestamp("process_update_target_date"),
  // Sign-off — 2 fixed rows, same reasoning.
  supplierRepSignature: text("supplier_rep_signature"),
  supplierRepDate: timestamp("supplier_rep_date"),
  qualityEngineerSignature: text("quality_engineer_signature"),
  qualityEngineerDate: timestamp("quality_engineer_date"),
  status: text("status").notNull().default("open"), // open | closed — see schema comment
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type ScarForm = typeof scarForms.$inferSelect;
