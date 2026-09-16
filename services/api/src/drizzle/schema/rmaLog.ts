import { pgTable, serial, text, integer, timestamp, numeric, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";
import { warrantyClaims } from "./warranty.js";
import { supplierRmaRequests } from "./supplierRma.js";
import { ncr } from "./ncr.js";

/**
 * The real, manually-maintained RMA Log register (module-specific RBAC
 * build, 2026-09-16) — NOT the automated Supplier RMA Request event trail
 * (see supplierRma.ts's rmaActivityLog, renamed at the same time to free
 * "rma_log" for this table). This is a customer-return register: every
 * field below is the literal, exact column list the brief specified, no
 * more, no less — comparable in spirit to CRAR (customer-facing return
 * documentation) but a lighter, faster-to-fill front-door record a
 * Customer Service/Quality user opens the moment a return is issued,
 * before (or instead of) a full CRAR investigation.
 *
 * Real integrations, each a nullable FK exactly like CRAR's own pattern
 * (link if applicable, never fabricate one):
 *   - warrantyId -> warranty_claims: this return is warranty-related.
 *   - supplierRmaRequestId -> supplier_rma_requests: root-caused to a
 *     specific supplier's defective part, already tracked on that request.
 *   - qualityId -> ncr: escalated into a formal Nonconformance.
 *
 * status is a fixed, linear lifecycle matching the field list's own
 * natural progression (see rmaLog.controller.ts's ALLOWED_NEXT):
 * open -> received -> under_review -> dispositioned -> closed.
 */
export const rmaLogRecords = pgTable(
  "rma_log",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
    status: text("status").notNull().default("open"),

    rmaNumber: text("rma_number").notNull(),
    dateIssued: timestamp("date_issued").notNull().defaultNow(),
    trackingNumber: text("tracking_number"),
    customerName: text("customer_name"),
    partNumber: text("part_number"),
    partDescription: text("part_description"),
    quantityReturned: numeric("quantity_returned"),
    originalOrderNumber: text("original_order_number"),
    serialNumber: text("serial_number"),
    customerReasonForReturn: text("customer_reason_for_return"),
    dateReceived: timestamp("date_received"),
    qualityTeamFindings: text("quality_team_findings"),
    // "Warranty, scrap, repair, replace, credit" per the brief's own list —
    // kept as free text (not a DB enum) matching this app's established
    // convention for record-status-style fields (see auditTrail.action's
    // own comment); validated to that fixed set at the API boundary
    // instead (rmaLog.validation.ts).
    dispositionAction: text("disposition_action"),
    correctiveAction: text("corrective_action"),
    creditMemo: text("credit_memo"),
    dateClosed: timestamp("date_closed"),

    warrantyId: integer("warranty_id").references(() => warrantyClaims.id),
    supplierRmaRequestId: integer("supplier_rma_request_id").references(() => supplierRmaRequests.id),
    qualityId: integer("quality_id").references(() => ncr.id),

    createdByUserId: integer("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => ({
    tenantRmaNumberUnique: uniqueIndex("rma_log_tenant_rma_number_idx").on(table.tenantId, table.rmaNumber),
  })
);

export type RmaLogRecord = typeof rmaLogRecords.$inferSelect;
export type NewRmaLogRecord = typeof rmaLogRecords.$inferInsert;
