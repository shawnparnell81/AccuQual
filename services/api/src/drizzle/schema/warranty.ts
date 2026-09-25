import { pgTable, serial, text, integer, timestamp, numeric, jsonb } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { customers } from "./customers.js";
import { inventoryItems } from "./inventory.js";
import { suppliers } from "./supplier.js";
import { ncr } from "./ncr.js";
import { workOrders } from "./workOrders.js";

/**
 * The Warranty module — a real, standalone lifecycle for a customer's
 * post-sale failure claim, from intake through inspection, a possible
 * supplier review, disposition, fulfillment, and closure. Manual paperwork
 * like every other module here: no automatic inventory/ERP side effects, no
 * background job, no "system" user.
 *
 * warrantyStatus: new | inspection | supplier_review | approved | rejected |
 *                 replaced | repaired | closed
 * See warranty.controller.ts's ALLOWED_NEXT for the real transition graph —
 * same "matrix grants edit, controller narrows per-transition department"
 * pattern as rma.ts/risk.ts.
 *
 * Document uploads (failure photos, repair reports, proof of purchase) are
 * NOT a separate warranty_claim_documents table — they go through the
 * existing generic `attachments` table (entityType:"warranty_claim"),
 * exactly like every other real record in this app (NCR/CAPA/RMA/etc. — see
 * attachments.ts's own comment). Building a second, parallel per-module
 * upload table here would duplicate a mechanism that already does real
 * disk storage, listing, download and uploader-or-admin delete. `documents`
 * stays as a lightweight jsonb summary field only for content the claim
 * itself displays inline (e.g. captioned failure images), not a storage
 * mechanism in its own right.
 */
export const warrantyClaims = pgTable("warranty_claims", {
  id: serial("id").primaryKey(),
  claimNumber: text("claim_number").notNull().unique(),
  status: text("status").notNull().default("new"),
  customerId: integer("customer_id").references(() => customers.id),
  productId: integer("product_id").references(() => inventoryItems.id),
  serialNumber: text("serial_number"),
  purchaseDate: timestamp("purchase_date"),
  failureDate: timestamp("failure_date"),
  failureDescription: text("failure_description"),
  // Captioned image references shown inline on the claim — [{url, caption}].
  // Real bytes for these (and any other evidence) live in `attachments`;
  // this jsonb only records which of those uploads are "the failure photos".
  failureImages: jsonb("failure_images").$type<{ attachmentId: number; caption?: string }[]>().default([]),
  // Same reasoning as failureImages — a lightweight index into `attachments`
  // for whichever uploads represent formal claim documents (repair report,
  // proof of purchase), not a second storage mechanism.
  documents: jsonb("documents").$type<{ attachmentId: number; label?: string }[]>().default([]),
  warrantyCostEstimate: numeric("warranty_cost_estimate"),
  warrantyActualCost: numeric("warranty_actual_cost"),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  linkedNcrId: integer("linked_ncr_id").references(() => ncr.id),
  linkedWorkOrderId: integer("linked_work_order_id").references(() => workOrders.id),
  // Free-text findings from the inspection step — kept as fields on the
  // claim itself (not a separate warranty_inspections table): the spec's
  // own required-tables list doesn't call for one, and one claim has
  // exactly one inspection outcome, not a repeatable child collection.
  inspectionNotes: text("inspection_notes"),
  inspectedByUserId: integer("inspected_by_user_id").references(() => users.id),
  inspectionDate: timestamp("inspection_date"),
  // The supplier's own reply, when supplierId is set and the claim moved
  // through supplier_review — recorded by internal staff relaying it (this
  // module has no supplier-facing login of its own, same as RMA).
  supplierReviewNotes: text("supplier_review_notes"),
  dispositionNotes: text("disposition_notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

/** One row per cost entry (parts/labor/shipping/replacement unit/etc.) — warrantyActualCost on the claim is the running sum, kept in sync by warranty.controller.ts, not computed on read. */
export const warrantyClaimCosts = pgTable("warranty_claim_costs", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").references(() => warrantyClaims.id).notNull(),
  costType: text("cost_type").notNull(), // parts | labor | shipping | replacement_unit | other
  amount: numeric("amount").notNull(),
  notes: text("notes"),
  recordedByUserId: integer("recorded_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * A dedicated, append-only transition timeline for the Warranty dashboard
 * (time-in-state analytics, e.g. "average days in supplier_review") — a
 * narrower, warranty-domain read model. Deliberately separate from the
 * generic `audit_trail` table (which also gets a "status_change" entry on
 * every transition, same as every other module's workflow — see
 * warranty.controller.ts): audit_trail is the tenant-wide immutable log
 * covering every entity type, not a convenient per-module analytics query
 * surface.
 */
export const warrantyClaimWorkflow = pgTable("warranty_claim_workflow", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").references(() => warrantyClaims.id).notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  note: text("note"),
  performedByUserId: integer("performed_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export type WarrantyClaim = typeof warrantyClaims.$inferSelect;
export type NewWarrantyClaim = typeof warrantyClaims.$inferInsert;
export type WarrantyClaimCost = typeof warrantyClaimCosts.$inferSelect;
export type WarrantyClaimWorkflowEntry = typeof warrantyClaimWorkflow.$inferSelect;
