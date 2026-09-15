import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { tenants } from "./tenants.js";
import { documents } from "./documents.js";

/**
 * Customer Onboarding — ONE table for both the master record AND its
 * onboarding workflow, mirroring suppliers.ts's own established pattern
 * (suppliers doesn't split "Supplier Master" from a separate "Supplier
 * Onboarding" table either — one row, one status lifecycle). See the
 * Customer Onboarding module review for why this consolidates the prompt's
 * originally-separate "Customer Master"/"Customer Onboarding" tables.
 *
 * The five "requirements" sub-forms (Qualification, Requirements, Quality,
 * Logistics, Contract) are deliberately NOT separate tables — they're one
 * real form (`customer_requirements`, see layouts/customerRequirements.ts)
 * in AccuQual's existing forms engine (form_data, entityId = this row's id),
 * the same real infrastructure every other QMS document in this app uses,
 * not a parallel one-off schema per form.
 *
 * The NDA is deliberately NOT modeled here at all (per the module's own
 * explicit exclusion) — `ndaDocumentId` links to a real, already-existing
 * Document Control record (the user uploads/manages the actual file there,
 * via the real /documents upload flow) rather than a new upload path.
 *
 * Customer Risk Assessment / Customer Feasibility Review are NOT separate
 * tables either — they're real rows in the existing risk_assessments /
 * feasibility_reviews tables, linked via their own sourceType="Customer"/
 * "customer" (see risk.validation.ts / feasibility.validation.ts).
 */
export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  legalName: text("legal_name").notNull(),
  dbaName: text("dba_name"),
  address: text("address"),
  billingAddress: text("billing_address"),
  website: text("website"),
  primaryContactName: text("primary_contact_name"),
  primaryContactEmail: text("primary_contact_email"),
  primaryContactPhone: text("primary_contact_phone"),
  industry: text("industry"),
  customerType: text("customer_type"), // OEM | Tier 1 | Tier 2 | Distributor | Other
  status: text("status").notNull().default("draft"), // draft -> submitted -> under_review -> approved -> activated | rejected
  department: text("department"), // who currently owns the review stage — informational, not itself an access gate
  ownerId: integer("owner_id").references(() => users.id),
  reviewerId: integer("reviewer_id").references(() => users.id),
  ndaDocumentId: integer("nda_document_id").references(() => documents.id),
  // Optional polymorphic link OUT to whatever real record this onboarding
  // case originated from — same pattern as risk_assessments'/
  // feasibility_reviews' own sourceType/sourceId, deliberately unconstrained
  // for the same reason (spans tables a single FK can't all target).
  relatedSourceType: text("related_source_type"), // NCR | Supplier | WorkOrder | Requisition | PO | RMA | Risk | Feasibility
  relatedSourceId: integer("related_source_id"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
  decidedAt: timestamp("decided_at"), // stamped on approve/reject
  activatedAt: timestamp("activated_at"),
});

export type Customer = typeof customers.$inferSelect;
