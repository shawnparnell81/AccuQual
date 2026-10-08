import { pgTable, serial, text, integer, timestamp, numeric } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { suppliers } from "./supplier.js";
import { ncr } from "./ncr.js";
import { capa } from "./capa.js";
import { inventoryItems } from "./inventory.js";
import { erpPurchaseOrders } from "./erp.js";

/**
 * Return Merchandise/Goods Authorization — a real, standalone module (Purchase
 * Orders + Receiving's sibling for the reverse direction), entirely manual
 * paperwork like every other module here: no automatic inventory_stock
 * movement, no automatic erp_purchase_orders change, no background job, no
 * "system" user (createdBy/approvedByUserId are always a real user or null).
 *
 * rmaNumber is the company's own number, typed by the person who opens the
 * return. It stays blank until they enter one. The same text can be used on
 * a different record type.
 *
 * status: draft | submitted_to_supplier | approved_by_supplier | in_transit |
 *         received_by_supplier | closed | cancelled
 * reasonCode: defective | wrong_item | over_shipment | under_shipment |
 *             quality_issue | other
 */
export const rma = pgTable("rma", {
  id: serial("id").primaryKey(),
  rmaNumber: text("rma_number"),
  status: text("status").notNull().default("draft"),
  supplierId: integer("supplier_id").references(() => suppliers.id).notNull(),
  reasonCode: text("reason_code"),
  // Optional linkage — an RMA does not require a quality event to exist; a
  // simple wrong-item/over-shipment return may never touch NCR/CAPA at all.
  linkedNcrId: integer("linked_ncr_id").references(() => ncr.id),
  linkedCapaId: integer("linked_capa_id").references(() => capa.id),
  // Set when an RMA auto-created from a Supplier Portal RMA Request could
  // be matched to a real purchase order (see rmaRequest.controller.ts's
  // own comment) — optional, same "match if we can, log honestly if we
  // can't" spirit as the part-number match on the same request.
  linkedPoId: integer("linked_po_id").references(() => erpPurchaseOrders.id),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const rmaItems = pgTable("rma_items", {
  id: serial("id").primaryKey(),
  rmaId: integer("rma_id").references(() => rma.id).notNull(),
  itemId: integer("item_id").references(() => inventoryItems.id).notNull(),
  description: text("description"),
  quantityReturned: numeric("quantity_returned").notNull(),
  unitOfMeasure: text("unit_of_measure"),
  reason: text("reason"),
  supplierResponse: text("supplier_response"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type Rma = typeof rma.$inferSelect;
export type RmaItem = typeof rmaItems.$inferSelect;
