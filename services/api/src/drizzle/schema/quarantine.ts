import { pgTable, serial, text, integer, timestamp, jsonb, boolean, numeric } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const QUARANTINE_STATUSES = ["quarantined", "released", "destroyed"] as const;
export type QuarantineStatus = (typeof QUARANTINE_STATUSES)[number];

/**
 * What can be put on hold. inventory_lot and inventory_item are ENFORCED: the inventory system itself refuses to issue, consume,
 * reserve or scrap held units (see inventory/inventoryHolds.service.ts). The rest are records of a hold that people are expected to
 * honour, and are labelled as such ("not enforced") wherever they appear.
 */
export const QUARANTINE_ITEM_TYPES = ["inventory_lot", "inventory_item", "finished_goods", "work_in_process", "equipment", "other"] as const;
export type QuarantineItemType = (typeof QUARANTINE_ITEM_TYPES)[number];
export const ENFORCED_ITEM_TYPES: readonly QuarantineItemType[] = ["inventory_lot", "inventory_item"];

export const QUARANTINE_REASON_CATEGORIES = ["nonconforming_material", "failed_inspection", "calibration_failure", "supplier_recall", "customer_return", "suspect_contamination", "other"] as const;
export type QuarantineReasonCategory = (typeof QUARANTINE_REASON_CATEGORIES)[number];

/**
 * One hold on some quantity of something. The quantity here is what is STILL on hold: a partial release or destroy reduces it, and the
 * record closes (released, or destroyed when nothing was ever released) when it reaches zero. The quarantine module keeps its own
 * tables; the only thing it writes elsewhere is the held-quantity counter the inventory system enforces.
 */
export const quarantineRecords = pgTable("quarantine_records", {
  id: serial("id").primaryKey(),
  itemType: text("item_type").$type<QuarantineItemType>().notNull(),
  /** inventory_lot -> inventory_lots.id; inventory_item -> inventory_items.id; otherwise unused. Deliberately not a foreign key: the module does not depend on the tables it can hold. */
  itemId: integer("item_id"),
  /** Name as it was when the hold was placed, so history stays readable if the item is renamed or removed. */
  itemLabel: text("item_label").notNull(),
  lotNumber: text("lot_number"),
  quantity: numeric("quantity").notNull(),
  originalQuantity: numeric("original_quantity").notNull(),
  unit: text("unit"),
  reasonCategory: text("reason_category").$type<QuarantineReasonCategory>().notNull().default("other"),
  reason: text("reason").notNull(),
  status: text("status").$type<QuarantineStatus>().notNull().default("quarantined"),
  /** True when the inventory system enforces this hold. False for holds that are only a record. */
  enforced: boolean("enforced").notNull().default(false),
  /** Where the hold came from: "receiving_line_item", "ncr", "manual"... */
  sourceType: text("source_type"),
  sourceId: integer("source_id"),
  /** The NCR handling the nonconformance, if any. Plain number, not a foreign key (see itemId). */
  ncrId: integer("ncr_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
  releasedAt: timestamp("released_at"),
  destroyedAt: timestamp("destroyed_at"),
  closedBy: integer("closed_by").references(() => users.id),
});

/** Where the held quantity physically is (a quarantine cage, a bin). The rows of one record add up to its quantity. */
export const quarantineInventory = pgTable("quarantine_inventory", {
  id: serial("id").primaryKey(),
  quarantineId: integer("quarantine_id").references(() => quarantineRecords.id).notNull(),
  location: text("location").notNull(),
  quantity: numeric("quantity").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

/** Each decision taken on (part of) a hold: released back into use, or removed from stock. Append-only history. */
export const quarantineResolutions = pgTable("quarantine_resolutions", {
  id: serial("id").primaryKey(),
  quarantineId: integer("quarantine_id").references(() => quarantineRecords.id).notNull(),
  action: text("action").$type<"release" | "destroy">().notNull(),
  /** release: use_as_is | reworked | sorted. destroy: scrapped | returned_to_supplier | other. */
  disposition: text("disposition").notNull(),
  quantity: numeric("quantity").notNull(),
  notes: text("notes").notNull(),
  resolvedBy: integer("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at").defaultNow(),
});

export type QuarantineRecord = typeof quarantineRecords.$inferSelect;
export type QuarantineInventoryRow = typeof quarantineInventory.$inferSelect;
export type QuarantineResolution = typeof quarantineResolutions.$inferSelect;
