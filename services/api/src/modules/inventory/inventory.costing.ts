import type { Request, Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { inventoryItems, inventoryStock, inventoryMovements } from "../../drizzle/schema/inventory.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import type { TenantDb } from "../../lib/tenantScope.js";
import type { InventoryItem } from "../../drizzle/schema/inventory.js";

const DEFAULT_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ItemCosting {
  itemId: number;
  sku: string;
  unitCost: number | null;
  onHand: number;
  itemValue: number | null; // null, not 0, when unitCost is unset — see the schema comment
  scrapCost: number | null;
  consumptionCost: number | null;
  days: number;
}

/**
 * No FIFO/LIFO/weighted-average — AccuQual stores no historical cost
 * layers, only each item's current unitCost (see the schema comment).
 * scrapCost/consumptionCost apply that current cost retroactively to past
 * movement quantities within the window; they're an estimate of "what that
 * scrap/consumption would cost at today's price," not the actual cost paid
 * at the time, exactly as the reviewed prompt specified.
 */
export async function computeItemCosting(db: TenantDb, tenantId: number, item: InventoryItem, days: number = DEFAULT_WINDOW_DAYS): Promise<ItemCosting> {
  const stockRows = await db.select().from(inventoryStock).where(and(eq(inventoryStock.itemId, item.id), eq(inventoryStock.tenantId, tenantId)));
  const onHand = stockRows.reduce((sum, r) => sum + Number(r.onHand), 0);

  const unitCost = item.unitCost === null ? null : Number(item.unitCost);
  const itemValue = unitCost === null ? null : unitCost * onHand;

  const since = Date.now() - days * DAY_MS;
  const movements = await db
    .select()
    .from(inventoryMovements)
    .where(and(eq(inventoryMovements.itemId, item.id), eq(inventoryMovements.tenantId, tenantId)));
  const inWindow = movements.filter((m) => new Date(m.performedAt ?? 0).getTime() >= since);

  const scrapQty = inWindow.filter((m) => m.movementType === "scrap").reduce((sum, m) => sum + Number(m.quantity), 0);
  const consumeQty = inWindow.filter((m) => m.movementType === "consume").reduce((sum, m) => sum + Number(m.quantity), 0);

  return {
    itemId: item.id,
    sku: item.sku,
    unitCost,
    onHand,
    itemValue,
    scrapCost: unitCost === null ? null : scrapQty * unitCost,
    consumptionCost: unitCost === null ? null : consumeQty * unitCost,
    days,
  };
}

export interface SupplierCostEntry {
  supplierId: number;
  supplierName: string;
  itemValue: number;
  scrapCost: number;
  consumptionCost: number;
  itemCount: number;
}

export interface CostingSummary {
  totalInventoryValue: number;
  uncostedItemCount: number;
  totalScrapCost: number;
  totalConsumptionCost: number;
  supplierCostDistribution: SupplierCostEntry[];
  days: number;
}

export async function computeCostingSummary(db: TenantDb, tenantId: number, days: number = DEFAULT_WINDOW_DAYS): Promise<CostingSummary> {
  const items = await db.select().from(inventoryItems).where(eq(inventoryItems.tenantId, tenantId));
  const costings = await Promise.all(items.map((item) => computeItemCosting(db, tenantId, item, days)));

  const uncostedItemCount = costings.filter((c) => c.unitCost === null).length;
  const totalInventoryValue = costings.reduce((sum, c) => sum + (c.itemValue ?? 0), 0);
  const totalScrapCost = costings.reduce((sum, c) => sum + (c.scrapCost ?? 0), 0);
  const totalConsumptionCost = costings.reduce((sum, c) => sum + (c.consumptionCost ?? 0), 0);

  const bySupplier = new Map<number, SupplierCostEntry>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (item.defaultSupplierId === null) continue;
    const costing = costings[i]!;
    const entry = bySupplier.get(item.defaultSupplierId) ?? { supplierId: item.defaultSupplierId, supplierName: "", itemValue: 0, scrapCost: 0, consumptionCost: 0, itemCount: 0 };
    entry.itemValue += costing.itemValue ?? 0;
    entry.scrapCost += costing.scrapCost ?? 0;
    entry.consumptionCost += costing.consumptionCost ?? 0;
    entry.itemCount += 1;
    bySupplier.set(item.defaultSupplierId, entry);
  }

  if (bySupplier.size > 0) {
    const supplierRows = await db.select().from(suppliers).where(and(eq(suppliers.tenantId, tenantId), inArray(suppliers.id, Array.from(bySupplier.keys()))));
    for (const s of supplierRows) {
      const entry = bySupplier.get(s.id);
      if (entry) entry.supplierName = s.name;
    }
  }

  return {
    totalInventoryValue,
    uncostedItemCount,
    totalScrapCost,
    totalConsumptionCost,
    supplierCostDistribution: Array.from(bySupplier.values()).sort((a, b) => b.itemValue - a.itemValue),
    days,
  };
}

async function loadItem(req: Request, id: number): Promise<InventoryItem> {
  const [item] = await req.db!.select().from(inventoryItems).where(and(eq(inventoryItems.id, id), eq(inventoryItems.tenantId, req.tenantId!)));
  if (!item) throw AppError.notFound("InventoryItem");
  return item;
}

function parseDays(req: Request): number {
  const days = Number(req.query.days);
  return Number.isFinite(days) && days > 0 ? Math.min(days, 365) : DEFAULT_WINDOW_DAYS;
}

/** GET /inventory/costing/:itemId?days=30 */
export const getItemCostingHandler = asyncHandler(async (req: Request, res: Response) => {
  const itemId = Number(req.params.itemId);
  const item = await loadItem(req, itemId);
  res.json(await computeItemCosting(req.db!, req.tenantId!, item, parseDays(req)));
});

/** GET /inventory/costing/summary?days=30 */
export const costingSummaryHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await computeCostingSummary(req.db!, req.tenantId!, parseDays(req)));
});
