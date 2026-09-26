import type { Request, Response } from "express";
import { and, eq, gte } from "drizzle-orm";
import { inventoryMovements, inventoryItems } from "../../drizzle/schema/inventory.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

/**
 * Every handler here aggregates real inventory_movements rows in JS after a
 * single fetch — same convention as listItemsHandler/
 * checkMinMaxHandler elsewhere in this module (fetch-and-aggregate, not a
 * raw SQL date_trunc/group-by escape hatch), appropriate at this app's
 * QMS scale. No Work Order module exists and none is assumed here — these
 * read only inventory_movements/inventory_items, the real tables.
 */

const MOVEMENT_TYPES = ["receive", "consume", "produce", "adjust", "scrap", "transfer"] as const;
type MovementType = (typeof MOVEMENT_TYPES)[number];

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday-anchored ISO week key (the date of that week's Monday, UTC). */
function weekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const isoDay = date.getUTCDay() || 7; // Sun=0 -> 7, so Mon=1..Sun=7
  if (isoDay !== 1) date.setUTCDate(date.getUTCDate() - (isoDay - 1));
  return date.toISOString().slice(0, 10);
}

function parseWindow(req: Request): { bucket: "day" | "week"; days: number; since: Date } {
  const bucket = req.query.bucket === "week" ? "week" : "day";
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return { bucket, days, since };
}

async function fetchMovements(req: Request, since: Date) {
  return req.db!
    .select()
    .from(inventoryMovements)
    .where(and(gte(inventoryMovements.performedAt, since)));
}

/** GET /inventory/analytics/movements — total quantity per movement type, bucketed by day or week. */
export const movementTrendsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { bucket, days, since } = parseWindow(req);
  const rows = await fetchMovements(req, since);
  const keyFn = bucket === "week" ? weekKey : dayKey;

  const buckets = new Map<string, Record<MovementType, number>>();
  for (const m of rows) {
    const key = keyFn(new Date(m.performedAt ?? Date.now()));
    const entry = buckets.get(key) ?? { receive: 0, consume: 0, produce: 0, adjust: 0, scrap: 0, transfer: 0 };
    entry[m.movementType as MovementType] += Number(m.quantity);
    buckets.set(key, entry);
  }

  const data = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, counts]) => ({ bucket, ...counts }));

  res.json({ bucket, days, data });
});

/** GET /inventory/analytics/consumption-vs-receiving — total consumed vs. total received per bucket. */
export const consumptionVsReceivingHandler = asyncHandler(async (req: Request, res: Response) => {
  const { bucket, days, since } = parseWindow(req);
  const rows = await fetchMovements(req, since);
  const keyFn = bucket === "week" ? weekKey : dayKey;

  const buckets = new Map<string, { consumed: number; received: number }>();
  for (const m of rows) {
    if (m.movementType !== "consume" && m.movementType !== "receive") continue;
    const key = keyFn(new Date(m.performedAt ?? Date.now()));
    const entry = buckets.get(key) ?? { consumed: 0, received: 0 };
    if (m.movementType === "consume") entry.consumed += Number(m.quantity);
    else entry.received += Number(m.quantity);
    buckets.set(key, entry);
  }

  const data = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, v]) => ({ bucket, ...v }));

  res.json({ bucket, days, data });
});

/** GET /inventory/analytics/scrap — scrap quantity grouped by item and by referenceType. */
export const scrapAnalyticsHandler = asyncHandler(async (req: Request, res: Response) => {
  const rows = await req.db!
    .select({
      itemId: inventoryMovements.itemId,
      quantity: inventoryMovements.quantity,
      referenceType: inventoryMovements.referenceType,
      sku: inventoryItems.sku,
    })
    .from(inventoryMovements)
    .innerJoin(inventoryItems, eq(inventoryMovements.itemId, inventoryItems.id))
    .where(and(eq(inventoryMovements.movementType, "scrap")));

  const byItem = new Map<number, { itemId: number; sku: string; quantity: number }>();
  const byReferenceType = new Map<string, number>();
  for (const r of rows) {
    const item = byItem.get(r.itemId) ?? { itemId: r.itemId, sku: r.sku, quantity: 0 };
    item.quantity += Number(r.quantity);
    byItem.set(r.itemId, item);

    const refKey = r.referenceType ?? "none";
    byReferenceType.set(refKey, (byReferenceType.get(refKey) ?? 0) + Number(r.quantity));
  }

  res.json({
    byItem: Array.from(byItem.values()).sort((a, b) => b.quantity - a.quantity),
    byReferenceType: Array.from(byReferenceType.entries()).map(([referenceType, quantity]) => ({ referenceType, quantity })),
  });
});

/** GET /inventory/analytics/reference-summary — every movement (any type) grouped by referenceType, with count + total quantity. */
export const referenceSummaryHandler = asyncHandler(async (req: Request, res: Response) => {
  const rows = await req.db!.select().from(inventoryMovements);

  const groups = new Map<string, { referenceType: string | null; count: number; quantity: number }>();
  for (const r of rows) {
    const key = r.referenceType ?? "none";
    const group = groups.get(key) ?? { referenceType: r.referenceType, count: 0, quantity: 0 };
    group.count += 1;
    group.quantity += Number(r.quantity);
    groups.set(key, group);
  }

  res.json(Array.from(groups.values()).sort((a, b) => b.count - a.count));
});
