import type { Request, Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { inventoryItems, inventoryMovements, inventoryReorderRequests, inventoryAlerts } from "../../drizzle/schema/inventory.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import type { TenantDb } from "../../lib/tenantScope.js";

const DELIVERY_FREQUENCY_WINDOW_DAYS = 90;
const OVERDUE_PENDING_THRESHOLD_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SupplierPerformance {
  supplierId: number;
  itemCount: number;
  deliveryFrequency: { count: number; days: number };
  deliveryTimeliness: { avgDays: number | null; sampleSize: number };
  deliveryAccuracy: { avgPercent: number | null; sampleSize: number };
  reorderResponsiveness: { overduePendingCount: number; thresholdDays: number };
  belowMinAlertCount: number;
  riskScore: "low" | "medium" | "high" | "no_data";
  riskPoints: number;
}

/**
 * Every number here comes from real rows this tenant already has —
 * inventory_items.default_supplier_id, inventory_movements (receive),
 * inventory_reorder_requests, inventory_alerts. No ERP, no Work Order
 * module, nothing external. Fetch-and-aggregate in JS, same convention as
 * every other analytics handler in this app (inventory.analytics.ts) —
 * not raw SQL aggregation, appropriate at this app's scale.
 *
 * Delivery timeliness/accuracy are a heuristic, not a guaranteed link:
 * nothing in the schema formally connects one reorder_request to the
 * movement that fulfills it (a receive movement's referenceType/
 * referenceId are free-form manual tags — see the Movement References
 * round — not a required foreign key back to a request). This pairs each
 * "sent" request with the earliest still-unclaimed receive movement on the
 * same item at or after the request was sent, which is the best available
 * real signal without inventing a link that doesn't exist.
 */
export async function computeSupplierPerformance(db: TenantDb, tenantId: number, supplierId: number): Promise<SupplierPerformance> {
  const items = await db.select().from(inventoryItems).where(and(eq(inventoryItems.tenantId, tenantId), eq(inventoryItems.defaultSupplierId, supplierId)));
  const itemIds = items.map((i) => i.id);

  if (itemIds.length === 0) {
    return {
      supplierId,
      itemCount: 0,
      deliveryFrequency: { count: 0, days: DELIVERY_FREQUENCY_WINDOW_DAYS },
      deliveryTimeliness: { avgDays: null, sampleSize: 0 },
      deliveryAccuracy: { avgPercent: null, sampleSize: 0 },
      reorderResponsiveness: { overduePendingCount: 0, thresholdDays: OVERDUE_PENDING_THRESHOLD_DAYS },
      belowMinAlertCount: 0,
      riskScore: "no_data",
      riskPoints: 0,
    };
  }

  const [movements, requests, alerts] = await Promise.all([
    db.select().from(inventoryMovements).where(and(eq(inventoryMovements.tenantId, tenantId), inArray(inventoryMovements.itemId, itemIds), eq(inventoryMovements.movementType, "receive"))),
    db.select().from(inventoryReorderRequests).where(and(eq(inventoryReorderRequests.tenantId, tenantId), inArray(inventoryReorderRequests.itemId, itemIds))),
    db.select().from(inventoryAlerts).where(and(eq(inventoryAlerts.tenantId, tenantId), inArray(inventoryAlerts.itemId, itemIds), eq(inventoryAlerts.alertType, "below_min"))),
  ]);

  const now = Date.now();
  const windowStart = now - DELIVERY_FREQUENCY_WINDOW_DAYS * DAY_MS;
  const deliveryFrequencyCount = movements.filter((m) => new Date(m.performedAt ?? now).getTime() >= windowStart).length;

  // Pair each sent request with the earliest unclaimed receive on the same item at/after it was sent.
  const claimedMovementIds = new Set<number>();
  const timelinessDays: number[] = [];
  const accuracyPercents: number[] = [];
  const sentRequests = requests.filter((r) => r.status === "sent").sort((a, b) => new Date(a.updatedAt ?? a.createdAt ?? 0).getTime() - new Date(b.updatedAt ?? b.createdAt ?? 0).getTime());
  for (const req of sentRequests) {
    const sentAt = new Date(req.updatedAt ?? req.createdAt ?? now).getTime();
    const candidates = movements
      .filter((m) => m.itemId === req.itemId && !claimedMovementIds.has(m.id) && new Date(m.performedAt ?? now).getTime() >= sentAt)
      .sort((a, b) => new Date(a.performedAt ?? 0).getTime() - new Date(b.performedAt ?? 0).getTime());
    const match = candidates[0];
    if (!match) continue;
    claimedMovementIds.add(match.id);

    const receivedAt = new Date(match.performedAt ?? now).getTime();
    timelinessDays.push((receivedAt - sentAt) / DAY_MS);

    const requestedQty = req.requestedQty;
    const receivedQty = Number(match.quantity);
    const accuracy = requestedQty === 0 ? 100 : Math.max(0, 100 - (Math.abs(receivedQty - requestedQty) / requestedQty) * 100);
    accuracyPercents.push(accuracy);
  }

  const overduePendingCount = requests.filter((r) => r.status === "pending" && now - new Date(r.createdAt ?? now).getTime() > OVERDUE_PENDING_THRESHOLD_DAYS * DAY_MS).length;
  const belowMinAlertCount = alerts.length;

  const avgDays = timelinessDays.length > 0 ? timelinessDays.reduce((a, b) => a + b, 0) / timelinessDays.length : null;
  const avgPercent = accuracyPercents.length > 0 ? accuracyPercents.reduce((a, b) => a + b, 0) / accuracyPercents.length : null;

  // Simple, transparent point heuristic — not a black box: each factor
  // contributes 0-2 points, total 0-8 maps to low/medium/high.
  const timelinessPoints = avgDays === null ? 0 : avgDays > 14 ? 2 : avgDays > 7 ? 1 : 0;
  const accuracyPoints = avgPercent === null ? 0 : avgPercent < 75 ? 2 : avgPercent < 90 ? 1 : 0;
  const alertPoints = belowMinAlertCount >= 6 ? 2 : belowMinAlertCount >= 3 ? 1 : 0;
  const overduePoints = overduePendingCount >= 3 ? 2 : overduePendingCount >= 1 ? 1 : 0;
  const riskPoints = timelinessPoints + accuracyPoints + alertPoints + overduePoints;
  const riskScore = riskPoints >= 5 ? "high" : riskPoints >= 2 ? "medium" : "low";

  return {
    supplierId,
    itemCount: itemIds.length,
    deliveryFrequency: { count: deliveryFrequencyCount, days: DELIVERY_FREQUENCY_WINDOW_DAYS },
    deliveryTimeliness: { avgDays: avgDays === null ? null : Math.round(avgDays * 10) / 10, sampleSize: timelinessDays.length },
    deliveryAccuracy: { avgPercent: avgPercent === null ? null : Math.round(avgPercent * 10) / 10, sampleSize: accuracyPercents.length },
    reorderResponsiveness: { overduePendingCount, thresholdDays: OVERDUE_PENDING_THRESHOLD_DAYS },
    belowMinAlertCount,
    riskScore,
    riskPoints,
  };
}

/** GET /suppliers/:id/performance */
export const getSupplierPerformanceHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [supplier] = await req.db!.select().from(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.tenantId, req.tenantId!)));
  if (!supplier) throw AppError.notFound("Supplier");

  res.json(await computeSupplierPerformance(req.db!, req.tenantId!, id));
});

/** GET /suppliers/performance-summary — every supplier's performance, for the Dashboard's supplier-risk stats. */
export const performanceSummaryHandler = asyncHandler(async (req: Request, res: Response) => {
  const allSuppliers = await req.db!.select().from(suppliers).where(eq(suppliers.tenantId, req.tenantId!));
  const results = await Promise.all(allSuppliers.map((s) => computeSupplierPerformance(req.db!, req.tenantId!, s.id)));
  res.json(results.map((r, i) => ({ ...r, supplierName: allSuppliers[i]!.name })));
});
