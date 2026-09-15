import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { tenants } from "./tenants.js";
import { customers } from "./customers.js";

/**
 * Rebuilt as a bespoke, fixed-structure document — same treatment as the
 * Work Order Traveler / Document Change Request / SCAR Form (see
 * [[accuqual-work-order-traveler]] and friends) — replacing the earlier
 * generic weighted-dimension-scoring engine (feasibility_scores child table,
 * a draft->submitted->under_review->approved|rejected workflow, a
 * polymorphic sourceType/sourceId link to 9 other modules). User supplied a
 * real "Contract & Project Feasibility Review Form" (QMS-FR-001) and
 * explicitly said the old version "stores less content" — this mirrors that
 * document exactly instead.
 *
 * The 7-row Multi-Disciplinary Feasibility Assessment and 5-row Sign-off
 * table are BOTH fixed, never user-addable — flattened to plain columns per
 * area/department rather than a child table, same convention scar_forms.ts
 * uses for its own fixed CAPA/sign-off rows.
 *
 * Scope narrowed per explicit request: reachable from Engineering (its own
 * department, not a shared cross-department floor like the old version) and
 * from the Customer Onboarding packet only (customerId, nullable) — NOT from
 * Work Orders/POs/NCR/PPAP/RMA/Complaints/Change/Suppliers, which all had a
 * "Start Feasibility Review" button before this rebuild.
 */
export const feasibilityReviews = pgTable("feasibility_reviews", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),

  // Launched from the Customer Onboarding packet — the one real link this
  // form keeps (see this file's own top comment on the other 8 being
  // dropped).
  customerId: integer("customer_id").references(() => customers.id),

  // --- Section 1: Document Control ---
  documentId: text("document_id").default("QMS-FR-001"),
  revision: text("revision").default("1.0"),
  effectiveDate: timestamp("effective_date"),
  processOwner: text("process_owner").default("Engineering / Quality Management"),

  // --- Section 2: Project & Customer Identification ---
  customerName: text("customer_name"),
  rfqQuoteNumber: text("rfq_quote_number"),
  partProjectName: text("part_project_name"),
  partNumberRev: text("part_number_rev"),
  targetDeliveryDate: timestamp("target_delivery_date"),
  annualEstimatedVolume: text("annual_estimated_volume"),

  // --- Section 3: Multi-Disciplinary Feasibility Assessment (7 fixed rows) ---
  // Each: feasible (yes|no|partial), riskLevel (low|medium|high), mitigation (free text).
  designFeasible: text("design_feasible"),
  designRiskLevel: text("design_risk_level"),
  designMitigation: text("design_mitigation"),

  equipmentFeasible: text("equipment_feasible"),
  equipmentRiskLevel: text("equipment_risk_level"),
  equipmentMitigation: text("equipment_mitigation"),

  supplyChainFeasible: text("supply_chain_feasible"),
  supplyChainRiskLevel: text("supply_chain_risk_level"),
  supplyChainMitigation: text("supply_chain_mitigation"),

  qualityFeasible: text("quality_feasible"),
  qualityRiskLevel: text("quality_risk_level"),
  qualityMitigation: text("quality_mitigation"),

  capacityFeasible: text("capacity_feasible"),
  capacityRiskLevel: text("capacity_risk_level"),
  capacityMitigation: text("capacity_mitigation"),

  regulatoryFeasible: text("regulatory_feasible"),
  regulatoryRiskLevel: text("regulatory_risk_level"),
  regulatoryMitigation: text("regulatory_mitigation"),

  financialFeasible: text("financial_feasible"),
  financialRiskLevel: text("financial_risk_level"),
  financialMitigation: text("financial_mitigation"),

  // --- Section 4: Resource & Tooling Requirements ---
  newToolingEquipment: text("new_tooling_equipment"),
  inspectionGagingNeeds: text("inspection_gaging_needs"),
  specialCustomerRequirements: text("special_customer_requirements"),

  // --- Section 5: Feasibility Determination & Conclusion ---
  determination: text("determination"), // feasible_as_quoted | feasible_with_conditions | not_feasible
  determinationNotes: text("determination_notes"),

  // --- Section 6: Sign-off & Authorizations (5 fixed rows) ---
  engineeringSignoffName: text("engineering_signoff_name"),
  engineeringSignoffSignature: text("engineering_signoff_signature"),
  engineeringSignoffDate: timestamp("engineering_signoff_date"), // server-stamped the moment signature transitions unset -> set

  qualitySignoffName: text("quality_signoff_name"),
  qualitySignoffSignature: text("quality_signoff_signature"),
  qualitySignoffDate: timestamp("quality_signoff_date"),

  manufacturingSignoffName: text("manufacturing_signoff_name"),
  manufacturingSignoffSignature: text("manufacturing_signoff_signature"),
  manufacturingSignoffDate: timestamp("manufacturing_signoff_date"),

  purchasingSignoffName: text("purchasing_signoff_name"),
  purchasingSignoffSignature: text("purchasing_signoff_signature"),
  purchasingSignoffDate: timestamp("purchasing_signoff_date"),

  salesSignoffName: text("sales_signoff_name"),
  salesSignoffSignature: text("sales_signoff_signature"),
  salesSignoffDate: timestamp("sales_signoff_date"),

  // Simple draft/final status, not the old multi-stage workflow — this
  // document's real approvals ARE the 5 sign-off rows above, not a separate
  // state machine. "Finalize" (engineering or admin only) is the one
  // deliberate transition, gated the same way the old "submit" step was
  // (see settings.feasibilitySettings.requiredDocuments) and routes the same
  // real notifyDepartment call on finalize.
  status: text("status").notNull().default("draft"), // draft | final
  finalizedAt: timestamp("finalized_at"),

  // Settings → Feasibility Module integration (still real, adapted to this
  // shape — see feasibility.controller.ts): providedDocuments is checked
  // against feasibilitySettings.requiredDocuments before Finalize is
  // allowed; ownerId auto-assigns to the creator when autoAssignOwner is on.
  providedDocuments: jsonb("provided_documents").$type<string[]>().default([]),
  ownerId: integer("owner_id").references(() => users.id),

  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type FeasibilityReview = typeof feasibilityReviews.$inferSelect;
