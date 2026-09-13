import { pgTable, serial, text, integer, timestamp, numeric, boolean, jsonb } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";
import { suppliers } from "./supplier.js";

/**
 * `state` is derived from stock vs. thresholds by inventory.service.ts's
 * recomputeState() and persisted here (same convention as every other
 * module owning its own status column) rather than recomputed on every
 * read — so History/Dashboard/alerts can filter and sort on it directly.
 * in_stock | below_min | reorder_pending | on_order | overstock | inactive
 */
export const inventoryItems = pgTable("inventory_items", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  sku: text("sku").notNull(),
  description: text("description"),
  itemType: text("item_type").notNull().default("raw_material"), // raw_material, wip, finished_good
  unitOfMeasure: text("unit_of_measure"),
  defaultSupplierId: integer("default_supplier_id").references(() => suppliers.id),
  minLevel: numeric("min_level").notNull().default("0"),
  maxLevel: numeric("max_level"),
  reorderQuantity: numeric("reorder_quantity"),
  leadTimeDays: integer("lead_time_days"),
  state: text("state").notNull().default("in_stock"),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

/** One row per (item, location) — the hot-path quantity, split from the slower-changing item metadata (same split calibration.ts uses for equipment/calibrations). */
export const inventoryStock = pgTable("inventory_stock", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  itemId: integer("item_id").references(() => inventoryItems.id).notNull(),
  location: text("location").notNull().default("default"),
  onHand: numeric("on_hand").notNull().default("0"),
  allocated: numeric("allocated").notNull().default("0"),
  onOrder: numeric("on_order").notNull().default("0"),
  lastAdjustedAt: timestamp("last_adjusted_at"),
  lastAdjustedBy: integer("last_adjusted_by").references(() => users.id),
});

/**
 * Append-only ledger — never edited or deleted; on_hand is derived by
 * replaying/aggregating these, not written directly, so history is never
 * lost. referenceType/referenceId are user-set manual tags (no Production
 * Work Order module exists to populate them automatically — see the
 * Production/Inventory integration review). referenceId is text, not a
 * foreign key: real values are free-form ("PL-2024-001", "Batch 17"), not
 * necessarily another table's numeric id.
 */
export const inventoryMovements = pgTable("inventory_movements", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  itemId: integer("item_id").references(() => inventoryItems.id).notNull(),
  movementType: text("movement_type").notNull(), // receive, consume, produce, adjust, scrap, transfer
  quantity: numeric("quantity").notNull(),
  fromLocation: text("from_location"),
  toLocation: text("to_location"),
  reason: text("reason"),
  referenceType: text("reference_type"), // e.g. production_log, manual, batch — free-form, user-set
  referenceId: text("reference_id"), // free-form, e.g. "PL-2024-001", "Batch 17" — not a foreign key
  performedBy: integer("performed_by").references(() => users.id),
  performedAt: timestamp("performed_at").defaultNow(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
});

export const inventoryAlerts = pgTable("inventory_alerts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  itemId: integer("item_id").references(() => inventoryItems.id).notNull(),
  alertType: text("alert_type").notNull(), // below_min, overstock
  triggeredAt: timestamp("triggered_at").defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedBy: integer("acknowledged_by").references(() => users.id),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
});

/**
 * A minimal, forward-compatible ERP reorder stub — no ERP integration
 * exists (see the ERP Reorder Request review), so this is created and
 * resolved entirely by real Purchasing users, never an external system.
 * Created when Purchasing calls mark-reorder-pending (the only real path
 * to that state — see inventory.service.ts's recomputeState), not by any
 * automatic min/max evaluation.
 */
export const inventoryReorderRequests = pgTable("inventory_reorder_requests", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  itemId: integer("item_id").references(() => inventoryItems.id).notNull(),
  requestedQty: integer("requested_qty").notNull(),
  status: text("status").notNull().default("pending"), // pending, sent, ignored
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type InventoryItem = typeof inventoryItems.$inferSelect;
export type InventoryStock = typeof inventoryStock.$inferSelect;
export type InventoryMovement = typeof inventoryMovements.$inferSelect;
export type InventoryAlert = typeof inventoryAlerts.$inferSelect;
export type InventoryReorderRequest = typeof inventoryReorderRequests.$inferSelect;
