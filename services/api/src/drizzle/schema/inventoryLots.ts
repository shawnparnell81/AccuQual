import { pgTable, serial, text, integer, timestamp, numeric } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { inventoryItems } from "./inventory.js";
import { suppliers } from "./supplier.js";
import { erpPurchaseOrders, erpReceivingLineItems } from "./erp.js";

/**
 * Phase 8 — the real per-lot/serial ledger this app didn't have before:
 * `inventory_movements.lotNumber`/`serialNumber` (added in an earlier
 * phase's Settings → Inventory expansion) were always just free-text tags
 * stamped onto each transaction row, with no way to answer "how much of
 * lot X is still on hand" or trace a lot back to the receiving event and
 * supplier that brought it in. This table is that missing link — one row
 * per lot (or per serial, for serialized items), created when a receiving
 * line item is applied to inventory (see erp.service.ts's
 * createReceivingDocument) and decremented as movements consume/scrap/
 * transfer/return against it (see inventory.service.ts's applyMovement,
 * which now accepts an optional lotId).
 *
 * This is deliberately NOT a full multi-warehouse lot-allocation engine
 * (no per-location lot split, no lot-level reservation) — at this app's
 * QMS/light-manufacturing scale, one remainingQty per lot across all
 * locations is the right amount of structure, matching every other
 * inventory concept in this schema (inventory_stock's own per-location
 * split is the one place location-level granularity already exists).
 *
 * status: active | consumed | scrapped | returned | expired
 */
export const inventoryLots = pgTable("inventory_lots", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  itemId: integer("item_id").references(() => inventoryItems.id).notNull(),
  lotNumber: text("lot_number").notNull(),
  serialNumber: text("serial_number"),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  purchaseOrderId: integer("purchase_order_id").references(() => erpPurchaseOrders.id),
  receivingLineItemId: integer("receiving_line_item_id").references(() => erpReceivingLineItems.id),
  revisionLevel: text("revision_level"),
  expirationDate: timestamp("expiration_date"),
  receivedQty: numeric("received_qty").notNull(),
  remainingQty: numeric("remaining_qty").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type InventoryLot = typeof inventoryLots.$inferSelect;
