import { pgTable, serial, text, integer, timestamp, numeric } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { suppliers } from "./supplier.js";
import { inventoryItems } from "./inventory.js";
import { ncr } from "./ncr.js";

/**
 * A real, standalone ERP module — Purchase Orders + Receiving, entirely
 * manual paperwork with no external ERP integration and no automatic
 * inventory movements (a received PO does not itself touch inventory_stock
 * — see erp.service.ts). createdBy is a nullable FK to a real user, never
 * a "system" sentinel — there are no background jobs in this app.
 *
 * status: draft | sent | partially_received | received | cancelled
 */
export const erpPurchaseOrders = pgTable("erp_purchase_orders", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").references(() => suppliers.id).notNull(),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  /** Phase 1 buyer-evaluation finding ("PO list columns") — purchasing's own ETA for the order, editable any time same as notes. */
  expectedDeliveryDate: timestamp("expected_delivery_date"),
});

export const erpPoLineItems = pgTable("erp_po_line_items", {
  id: serial("id").primaryKey(),
  purchaseOrderId: integer("purchase_order_id").references(() => erpPurchaseOrders.id).notNull(),
  itemId: integer("item_id").references(() => inventoryItems.id).notNull(),
  quantity: integer("quantity").notNull(),
  unitCost: numeric("unit_cost"),
  notes: text("notes"),
});

export const erpReceivingDocuments = pgTable("erp_receiving_documents", {
  id: serial("id").primaryKey(),
  purchaseOrderId: integer("purchase_order_id").references(() => erpPurchaseOrders.id).notNull(),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  notes: text("notes"),
});

/**
 * Ties each receipt line back to the exact PO line it fulfills (not just
 * the item) — that's what lets a PO's status move from "sent" to
 * "partially_received" to "received" by actually comparing received vs.
 * ordered quantity per line, instead of guessing from a bare item count.
 *
 * Phase 8 — a receiving line item now carries a real structured
 * inspection-workflow status (previously none at all: a line was just "how
 * much arrived," with no pass/fail concept), and the lot/serial captured at
 * the moment of physical receipt (mirrored onto a real inventory_lots row
 * — see inventoryLots.ts — once this line is applied to inventory).
 * status: received | pending_inspection | inspected | accepted | rejected |
 * quarantined | disposition_required
 */
export const erpReceivingLineItems = pgTable("erp_receiving_line_items", {
  id: serial("id").primaryKey(),
  receivingDocumentId: integer("receiving_document_id").references(() => erpReceivingDocuments.id).notNull(),
  poLineItemId: integer("po_line_item_id").references(() => erpPoLineItems.id).notNull(),
  quantityReceived: integer("quantity_received").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("received"),
  lotNumber: text("lot_number"),
  serialNumber: text("serial_number"),
});

/**
 * A real Purchase Requisition — the pre-PO request/approval step the AI
 * PR Justification review assumed already existed. It didn't: the only
 * thing close to it was `inventory_reorder_requests` (inventory.ts), a
 * narrower stub created only by Purchasing's own mark-reorder-pending
 * action, with no approval workflow and no path to a real PO. This table
 * generalizes that idea into a real requisition any requesting department
 * can raise — production/material_management/quality/engineering can
 * create their own draft; purchasing approves, rejects, or converts one
 * to a real Purchase Order (see erp.controller.ts's convertToPoHandler).
 * `justification` is free text — the field AI PR Justification drafts and
 * the user edits/saves via the normal PATCH endpoint.
 *
 * status: draft | pending_approval | approved | rejected | converted_to_po
 */
export const erpPurchaseRequisitions = pgTable("erp_purchase_requisitions", {
  id: serial("id").primaryKey(),
  requestedBy: integer("requested_by").references(() => users.id),
  department: text("department"),
  itemId: integer("item_id").references(() => inventoryItems.id).notNull(),
  quantity: integer("quantity").notNull(),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  linkedNcrId: integer("linked_ncr_id").references(() => ncr.id),
  justification: text("justification"),
  status: text("status").notNull().default("draft"),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  purchaseOrderId: integer("purchase_order_id").references(() => erpPurchaseOrders.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type ErpPurchaseOrder = typeof erpPurchaseOrders.$inferSelect;
export type ErpPoLineItem = typeof erpPoLineItems.$inferSelect;
export type ErpReceivingDocument = typeof erpReceivingDocuments.$inferSelect;
export type ErpReceivingLineItem = typeof erpReceivingLineItems.$inferSelect;
export type ErpPurchaseRequisition = typeof erpPurchaseRequisitions.$inferSelect;
export type NewErpPurchaseRequisition = typeof erpPurchaseRequisitions.$inferInsert;
