import { sql, and, eq, gte, lte, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { ncr } from "../../drizzle/schema/ncr.js";
import { capa } from "../../drizzle/schema/capa.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { warrantyClaims } from "../../drizzle/schema/warranty.js";
import { qualityInspectionReports } from "../../drizzle/schema/qualityInspectionReports.js";
import { inventoryAlerts, inventoryMovements } from "../../drizzle/schema/inventory.js";
import { erpReceivingLineItems } from "../../drizzle/schema/erp.js";
import { computeSupplierPerformance } from "../supplier/supplier.performance.js";
import type { Db } from "../../lib/requestDb.js";

/**
 * Phase 6 Reporting & Analytics Hub — the dedicated service layer the phase
 * asked for. Distinct from the existing Dashboard (DashboardPage.tsx),
 * which fetches every raw row client-side via .useList() and computes
 * everything in the browser (no pagination, no server-side aggregation, no
 * caching — confirmed by reading it directly). Every function here does
 * its aggregation in the database (COUNT/GROUP BY/date_trunc), not in JS
 * after fetching every row, and every result goes through the in-memory
 * cache below — the real gap the phase's "add caching for heavy queries"
 * task named.
 */

export interface DateRange {
  from?: Date;
  to?: Date;
}

// ---------------------------------------------------------------------------
// Caching — a simple in-memory TTL cache, not Redis. This app's real
// deployment (see DEPLOY.md / render.yaml) runs the API as one Render web
// service instance, not a horizontally-scaled fleet, so a per-process cache
// is both correct and far simpler than standing up a shared cache for a
// scale this app doesn't operate at yet. If that ever changes, swap this
// module's two functions for Redis (already used elsewhere — see
// lib/eventBus.ts) without touching any caller.
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { value: unknown; expiresAt: number }>();

async function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await compute();
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Every report-generating action (a dashboard load, a scheduled send, a manual "Send Now") should call this after mutating state that would make a cached report stale — there are none today (reports are read-only rollups of records other modules own), but this is the one place to clear from if that ever changes. */
export function clearReportingCache(tenantId: number): void {
  for (const key of cache.keys()) if (key.startsWith(`t${tenantId}:`)) cache.delete(key);
}

function dateFilter(column: PgColumn, range?: DateRange): SQL[] {
  const clauses: SQL[] = [];
  if (range?.from) clauses.push(gte(column, range.from));
  if (range?.to) clauses.push(lte(column, range.to));
  return clauses;
}

// ---------------------------------------------------------------------------
// NCR metrics
// ---------------------------------------------------------------------------
export interface NcrMetrics {
  totalOpen: number;
  totalClosed: number;
  bySeverity: { severity: string; count: number }[];
  byStatus: { status: string; count: number }[];
  byMonth: { month: string; count: number }[];
  avgClosureDays: number | null;
}

export async function getNcrMetrics(db: Db, tenantId: number, range?: DateRange): Promise<NcrMetrics> {
  return cached(`t${tenantId}:ncr:${JSON.stringify(range)}`, async () => {
    const where = and(eq(ncr.isDeleted, false), ...dateFilter(ncr.createdAt, range));

    const [openRow] = await db.select({ count: sql<number>`count(*)::int` }).from(ncr).where(and(where, sql`${ncr.status} != 'closed'`));
    const [closedRow] = await db.select({ count: sql<number>`count(*)::int` }).from(ncr).where(and(where, eq(ncr.status, "closed")));

    const bySeverity = await db
      .select({ severity: sql<string>`coalesce(${ncr.severity}, 'unspecified')`, count: sql<number>`count(*)::int` })
      .from(ncr)
      .where(where)
      .groupBy(sql`coalesce(${ncr.severity}, 'unspecified')`);

    const byStatus = await db
      .select({ status: ncr.status, count: sql<number>`count(*)::int` })
      .from(ncr)
      .where(where)
      .groupBy(ncr.status);

    const byMonth = await db
      .select({ month: sql<string>`to_char(date_trunc('month', ${ncr.createdAt}), 'YYYY-MM')`, count: sql<number>`count(*)::int` })
      .from(ncr)
      .where(where)
      .groupBy(sql`date_trunc('month', ${ncr.createdAt})`)
      .orderBy(sql`date_trunc('month', ${ncr.createdAt})`);

    const [avgRow] = await db
      .select({ avgDays: sql<number | null>`avg(extract(epoch from (${ncr.closedAt} - ${ncr.createdAt})) / 86400)` })
      .from(ncr)
      .where(and(where, eq(ncr.status, "closed")));

    return {
      totalOpen: openRow?.count ?? 0,
      totalClosed: closedRow?.count ?? 0,
      bySeverity,
      byStatus,
      byMonth,
      avgClosureDays: avgRow?.avgDays !== null && avgRow?.avgDays !== undefined ? Math.round(Number(avgRow.avgDays) * 10) / 10 : null,
    };
  });
}

// ---------------------------------------------------------------------------
// CAPA metrics
// ---------------------------------------------------------------------------
export interface CapaMetrics {
  total: number;
  closed: number;
  effectivenessRate: number; // closed / total, 0-100
  byStatus: { status: string; count: number }[];
  byMonth: { month: string; count: number }[];
  avgClosureDays: number | null;
}

export async function getCapaMetrics(db: Db, tenantId: number, range?: DateRange): Promise<CapaMetrics> {
  return cached(`t${tenantId}:capa:${JSON.stringify(range)}`, async () => {
    const where = and(...dateFilter(capa.createdAt, range));

    const [totalRow] = await db.select({ count: sql<number>`count(*)::int` }).from(capa).where(where);
    const [closedRow] = await db.select({ count: sql<number>`count(*)::int` }).from(capa).where(and(where, eq(capa.status, "closed")));

    const byStatus = await db.select({ status: capa.status, count: sql<number>`count(*)::int` }).from(capa).where(where).groupBy(capa.status);

    const byMonth = await db
      .select({ month: sql<string>`to_char(date_trunc('month', ${capa.createdAt}), 'YYYY-MM')`, count: sql<number>`count(*)::int` })
      .from(capa)
      .where(where)
      .groupBy(sql`date_trunc('month', ${capa.createdAt})`)
      .orderBy(sql`date_trunc('month', ${capa.createdAt})`);

    const [avgRow] = await db
      .select({ avgDays: sql<number | null>`avg(extract(epoch from (${capa.closedAt} - ${capa.createdAt})) / 86400)` })
      .from(capa)
      .where(and(where, eq(capa.status, "closed")));

    const total = totalRow?.count ?? 0;
    const closed = closedRow?.count ?? 0;
    return {
      total,
      closed,
      effectivenessRate: total > 0 ? Math.round((closed / total) * 1000) / 10 : 0,
      byStatus,
      byMonth,
      avgClosureDays: avgRow?.avgDays !== null && avgRow?.avgDays !== undefined ? Math.round(Number(avgRow.avgDays) * 10) / 10 : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Supplier performance report — reuses computeSupplierPerformance (the same
// "v1 weighted formula" the Dashboard and Supplier detail pages already
// read) per supplier, then aggregates the risk-bucket distribution across
// the whole tenant, which no existing endpoint does.
// ---------------------------------------------------------------------------
export interface SupplierPerformanceReport {
  suppliers: { id: number; name: string; riskScore: string; onTimeAvgDays: number | null; accuracyAvgPercent: number | null }[];
  riskDistribution: { riskScore: string; count: number }[];
}

export async function getSupplierPerformanceReport(db: Db, tenantId: number): Promise<SupplierPerformanceReport> {
  return cached(`t${tenantId}:supplier-performance`, async () => {
    const rows = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers);
    const results = await Promise.all(
      rows.map(async (s) => {
        const perf = await computeSupplierPerformance(db, s.id);
        return { id: s.id, name: s.name, riskScore: perf.riskScore, onTimeAvgDays: perf.deliveryTimeliness.avgDays, accuracyAvgPercent: perf.deliveryAccuracy.avgPercent };
      })
    );
    const distribution = new Map<string, number>();
    for (const r of results) distribution.set(r.riskScore, (distribution.get(r.riskScore) ?? 0) + 1);
    return { suppliers: results, riskDistribution: [...distribution.entries()].map(([riskScore, count]) => ({ riskScore, count })) };
  });
}

// ---------------------------------------------------------------------------
// Warranty / RMA trends
// ---------------------------------------------------------------------------
export interface WarrantyTrends {
  total: number;
  byStatus: { status: string; count: number }[];
  byMonth: { month: string; count: number }[];
  totalActualCost: number;
}

export async function getWarrantyTrends(db: Db, tenantId: number, range?: DateRange): Promise<WarrantyTrends> {
  return cached(`t${tenantId}:warranty:${JSON.stringify(range)}`, async () => {
    const where = and(...dateFilter(warrantyClaims.createdAt, range));

    const [totalRow] = await db.select({ count: sql<number>`count(*)::int` }).from(warrantyClaims).where(where);
    const byStatus = await db.select({ status: warrantyClaims.status, count: sql<number>`count(*)::int` }).from(warrantyClaims).where(where).groupBy(warrantyClaims.status);
    const byMonth = await db
      .select({ month: sql<string>`to_char(date_trunc('month', ${warrantyClaims.createdAt}), 'YYYY-MM')`, count: sql<number>`count(*)::int` })
      .from(warrantyClaims)
      .where(where)
      .groupBy(sql`date_trunc('month', ${warrantyClaims.createdAt})`)
      .orderBy(sql`date_trunc('month', ${warrantyClaims.createdAt})`);
    const [costRow] = await db.select({ total: sql<number>`coalesce(sum(${warrantyClaims.warrantyActualCost}), 0)::float` }).from(warrantyClaims).where(where);

    return { total: totalRow?.count ?? 0, byStatus, byMonth, totalActualCost: costRow?.total ?? 0 };
  });
}

// ---------------------------------------------------------------------------
// Receiving inspection trends — quality_inspection_reports rows where
// inspectionType = "incoming" are this app's real receiving-inspection
// record (see that schema's own comment: incoming | in_process | final).
// ---------------------------------------------------------------------------
export interface ReceivingTrends {
  total: number;
  acceptRate: number | null; // 0-100
  byFinalStatus: { status: string; count: number }[];
  byMonth: { month: string; count: number }[];
  // Phase 8 task 8 — the Receiving Dashboard's remaining widgets.
  // inspectionBacklog: incoming inspections with no disposition decided
  // yet (finalStatus still null) — the real "how much is waiting on
  // Quality" count nothing computed before this phase.
  inspectionBacklog: number;
  // quarantineCount: live count of erp_receiving_line_items currently
  // sitting at "quarantined" — a genuinely different signal than
  // byFinalStatus above (that's the INSPECTION report's disposition;
  // quarantine is the RECEIVING LINE ITEM's own workflow state — see
  // erp.ts's schema comment — so a line can be quarantined without its
  // inspection report's finalStatus reflecting that at all).
  quarantineCount: number;
  bySupplier: { supplierId: number; supplierName: string; count: number }[];
}

export async function getReceivingTrends(db: Db, tenantId: number, range?: DateRange): Promise<ReceivingTrends> {
  return cached(`t${tenantId}:receiving:${JSON.stringify(range)}`, async () => {
    const where = and(
      eq(qualityInspectionReports.inspectionType, "incoming"), ...dateFilter(qualityInspectionReports.createdAt, range)
    );

    const [totalRow] = await db.select({ count: sql<number>`count(*)::int` }).from(qualityInspectionReports).where(where);
    const [acceptedRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(qualityInspectionReports)
      .where(and(where, eq(qualityInspectionReports.finalStatus, "accepted")));
    const [backlogRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(qualityInspectionReports)
      .where(and(where, sql`${qualityInspectionReports.finalStatus} is null`));
    const byFinalStatus = await db
      .select({ status: sql<string>`coalesce(${qualityInspectionReports.finalStatus}, 'pending')`, count: sql<number>`count(*)::int` })
      .from(qualityInspectionReports)
      .where(where)
      .groupBy(sql`coalesce(${qualityInspectionReports.finalStatus}, 'pending')`);
    const byMonth = await db
      .select({ month: sql<string>`to_char(date_trunc('month', ${qualityInspectionReports.createdAt}), 'YYYY-MM')`, count: sql<number>`count(*)::int` })
      .from(qualityInspectionReports)
      .where(where)
      .groupBy(sql`date_trunc('month', ${qualityInspectionReports.createdAt})`)
      .orderBy(sql`date_trunc('month', ${qualityInspectionReports.createdAt})`);
    const bySupplier = await db
      .select({ supplierId: qualityInspectionReports.supplierId, supplierName: suppliers.name, count: sql<number>`count(*)::int` })
      .from(qualityInspectionReports)
      .innerJoin(suppliers, eq(qualityInspectionReports.supplierId, suppliers.id))
      .where(and(where, sql`${qualityInspectionReports.finalStatus} = 'rejected'`))
      .groupBy(qualityInspectionReports.supplierId, suppliers.name);

    const [quarantineRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(erpReceivingLineItems)
      .where(and(eq(erpReceivingLineItems.status, "quarantined")));

    const total = totalRow?.count ?? 0;
    return {
      total,
      acceptRate: total > 0 ? Math.round(((acceptedRow?.count ?? 0) / total) * 1000) / 10 : null,
      byFinalStatus,
      byMonth,
      inspectionBacklog: backlogRow?.count ?? 0,
      quarantineCount: quarantineRow?.count ?? 0,
      bySupplier: bySupplier.filter((r): r is { supplierId: number; supplierName: string; count: number } => r.supplierId !== null),
    };
  });
}

// ---------------------------------------------------------------------------
// Inventory quality trends — scrap movements over time + current below-min
// alert count. Distinct from the Dashboard's existing scrap/movement charts
// (current-state snapshots): this is the same underlying data, aggregated
// by month for a real trend line, which nothing existing computes.
// ---------------------------------------------------------------------------
export interface InventoryQualityTrends {
  currentBelowMinCount: number;
  scrapByMonth: { month: string; quantity: number }[];
  // Phase 8 task 9 — the Inventory Dashboard's "consumption trends" widget;
  // same monthly-aggregation shape as scrapByMonth, just a different
  // movementType, so the two can share one chart's two lines.
  consumptionByMonth: { month: string; quantity: number }[];
}

async function movementQuantityByMonth(db: Db, movementType: string, range?: DateRange) {
  const where = and(eq(inventoryMovements.movementType, movementType), ...dateFilter(inventoryMovements.performedAt, range));
  return db
    .select({ month: sql<string>`to_char(date_trunc('month', ${inventoryMovements.performedAt}), 'YYYY-MM')`, quantity: sql<number>`coalesce(sum(${inventoryMovements.quantity}), 0)::float` })
    .from(inventoryMovements)
    .where(where)
    .groupBy(sql`date_trunc('month', ${inventoryMovements.performedAt})`)
    .orderBy(sql`date_trunc('month', ${inventoryMovements.performedAt})`);
}

export async function getInventoryQualityTrends(db: Db, tenantId: number, range?: DateRange): Promise<InventoryQualityTrends> {
  return cached(`t${tenantId}:inventory-quality:${JSON.stringify(range)}`, async () => {
    const [belowMinRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(inventoryAlerts)
      .where(and(eq(inventoryAlerts.alertType, "below_min"), sql`${inventoryAlerts.acknowledgedAt} is null`));

    const [scrapByMonth, consumptionByMonth] = await Promise.all([movementQuantityByMonth(db, "scrap", range), movementQuantityByMonth(db, "consume", range)]);

    return { currentBelowMinCount: belowMinRow?.count ?? 0, scrapByMonth, consumptionByMonth };
  });
}

// ---------------------------------------------------------------------------
// Workflow cycle-time metrics — real creation-to-close timings per module,
// reusing each table's own createdAt/closedAt rather than parsing
// audit_trail's free-form jsonb `changes` blob (fragile — its shape differs
// per module and per action, see audit-trail.service.ts) for something
// every one of these tables already records as real, indexed columns.
// ---------------------------------------------------------------------------
export interface WorkflowCycleTimeMetrics {
  ncrAvgDays: number | null;
  capaAvgDays: number | null;
}

export async function getWorkflowCycleTimeMetrics(db: Db, tenantId: number, range?: DateRange): Promise<WorkflowCycleTimeMetrics> {
  const [ncrMetrics, capaMetrics] = await Promise.all([getNcrMetrics(db, tenantId, range), getCapaMetrics(db, tenantId, range)]);
  return { ncrAvgDays: ncrMetrics.avgClosureDays, capaAvgDays: capaMetrics.avgClosureDays };
}
