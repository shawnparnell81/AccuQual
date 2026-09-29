import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { suppliers } from "./supplier.js";
import { rma } from "./rma.js";

/**
 * A supplier's portal request. New submissions are NCR requests for Quality
 * to review (see ncrRequest.controller.ts): status stays "submitted", and
 * createdRmaId stays empty. Older rows may still say "rma_created" from
 * before this create path stopped opening an RMA. supplierId is always the
 * submitting login's own users.supplierId.
 */
export const supplierRmaRequests = pgTable("supplier_rma_requests", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").references(() => suppliers.id).notNull(),
  status: text("status").notNull().default("submitted"),

  companyName: text("company_name").notNull(),
  contactName: text("contact_name").notNull(),
  email: text("email").notNull(),
  phoneNumber: text("phone_number"),
  poNumber: text("po_number"),
  partNumber: text("part_number"),
  poDate: timestamp("po_date"), // "Date PO Was Submitted"
  customerClaimNumber: text("customer_claim_number"),
  shortDescription: text("short_description"),
  description: text("description"), // the one full text block

  // Set once the real RMA is created from this request (same request,
  // synchronously) — the actual "AI transfers supplier data into the RMA"
  // link.
  createdRmaId: integer("created_rma_id").references(() => rma.id),
  submittedByUserId: integer("submitted_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * A dedicated, Quality/Customer-Service-facing feed of the supplier-RMA
 * pipeline's own lifecycle events — deliberately separate from the
 * general-purpose, company-wide `audit_trail` table (which already logs
 * every create/update on every entity type, but isn't a business-readable
 * "here's every RMA request and what happened to it" report on its own).
 * One row per real event: request submitted, RMA auto-created + numbered,
 * part/PO auto-match result, notifications sent.
 *
 * Renamed from "rma_log" to "rma_activity_log" (module-specific RBAC
 * build, 2026-09-16) — "RMA Log" now names the real, manually-maintained
 * customer-return register built at that time (see the new
 * drizzle/schema/rmaLog.ts), a completely different table this automated
 * event trail must never be confused with. This table's own data/behavior
 * is 100% unchanged, only its name and route moved (see
 * modules/rma-activity-log/).
 */
export const rmaActivityLog = pgTable("rma_activity_log", {
  id: serial("id").primaryKey(),
  rmaId: integer("rma_id").references(() => rma.id),
  supplierRmaRequestId: integer("supplier_rma_request_id").references(() => supplierRmaRequests.id),
  event: text("event").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>(),
  // Null means system-derived (e.g. an auto-match result), never a
  // fabricated "system user" row in `users` — see users.ts's own
  // supplierId comment on this app's "real user or null" rule.
  performedBy: integer("performed_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export type SupplierRmaRequest = typeof supplierRmaRequests.$inferSelect;
export type NewSupplierRmaRequest = typeof supplierRmaRequests.$inferInsert;
export type RmaActivityLogEntry = typeof rmaActivityLog.$inferSelect;
