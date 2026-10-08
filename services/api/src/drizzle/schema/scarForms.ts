import { pgTable, serial, text, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { suppliers } from "./supplier.js";

/**
 * Internal SCAR sheet. Not the generic simple-form engine: the header does not
 * match Form No. / Revision / Prepared By, root cause is five fields, and the
 * CAPA and sign-off rows are fixed labels (3 and 2), so they are columns.
 * A child table is only used where the source sheet has a freely addable table.
 * `status` (`open` / `closed`) is not on the source sheet. The list filters on it.
 */
export const scarForms = pgTable("scar_forms", {
  id: serial("id").primaryKey(),
  scarNumber: text("scar_number"),
  dateIssued: timestamp("date_issued"),
  supplierName: text("supplier_name"),
  // the free-text supplierName above predates any real link to
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
  signatureRequired: jsonb("signature_required").$type<Record<string, "yes" | "no">>(),
  status: text("status").notNull().default("open"), // open | closed — see schema comment
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type ScarForm = typeof scarForms.$inferSelect;
