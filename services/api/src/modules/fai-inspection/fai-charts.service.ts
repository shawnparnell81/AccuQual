import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { roleHasPermission } from "../roles/rolePermissions.js";
import { FAI_VIEW_PERMISSION } from "../roles/roleAccess.js";
import { inspRecords } from "../../drizzle/schema/faiInspection.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { deny } from "./fai-inspection.service.js";

async function requirePerm(db: Db, user: any) {
  const roleName = user?.role ?? user?.roleName;
  const allowed = await roleHasPermission(db, roleName, FAI_VIEW_PERMISSION);
  if (!allowed) await deny(db, user, FAI_VIEW_PERMISSION, "view the FAI dashboard charts");
}

function siteFilter(siteId: number | null) {
  return siteId ? eq(inspRecords.siteId, siteId) : undefined;
}

/** Pass rate by month, last 12 months (including the current one). Months with zero signed records show 0/0, not an error. */
export async function passRateByMonth(db: Db, user: any, siteId: number | null) {
  await requirePerm(db, user);
  const sf = siteFilter(siteId);
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
  twelveMonthsAgo.setDate(1);
  const rows = await db.select({ month: sql<string>`to_char(${inspRecords.signedAt}, 'YYYY-MM')`, status: inspRecords.status, n: sql<number>`count(*)` })
    .from(inspRecords)
    .where(sf ? and(sf, inArray(inspRecords.status, ["passed", "failed"]), gte(inspRecords.signedAt, twelveMonthsAgo)) : and(inArray(inspRecords.status, ["passed", "failed"]), gte(inspRecords.signedAt, twelveMonthsAgo)))
    .groupBy(sql`to_char(${inspRecords.signedAt}, 'YYYY-MM')`, inspRecords.status);

  const byMonth = new Map<string, { passed: number; failed: number }>();
  const months: string[] = [];
  const cursor = new Date(twelveMonthsAgo);
  for (let i = 0; i < 12; i++) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    months.push(key);
    byMonth.set(key, { passed: 0, failed: 0 });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  for (const r of rows) {
    const bucket = byMonth.get(r.month);
    if (!bucket) continue;
    if (r.status === "passed") bucket.passed = Number(r.n);
    else bucket.failed = Number(r.n);
  }
  return months.map((month) => {
    const b = byMonth.get(month)!;
    const total = b.passed + b.failed;
    return { month, passed: b.passed, failed: b.failed, total, passRate: total > 0 ? Math.round((b.passed / total) * 1000) / 10 : 0 };
  });
}

/** FAIs by trigger reason (all statuses, all time within the current plant filter). */
export async function byTriggerReason(db: Db, user: any, siteId: number | null) {
  await requirePerm(db, user);
  const sf = siteFilter(siteId);
  const rows = await db.select({ triggerReason: inspRecords.triggerReason, n: sql<number>`count(*)` })
    .from(inspRecords).where(sf).groupBy(inspRecords.triggerReason);
  return rows.map((r) => ({ triggerReason: r.triggerReason ?? "Not specified", count: Number(r.n) })).sort((a, b) => b.count - a.count);
}

/** Failures by supplier, top 10. */
export async function failuresBySupplier(db: Db, user: any, siteId: number | null) {
  await requirePerm(db, user);
  const sf = siteFilter(siteId);
  const rows = await db.select({ supplierName: suppliers.name, n: sql<number>`count(*)` })
    .from(inspRecords)
    .innerJoin(suppliers, eq(suppliers.id, inspRecords.supplierId))
    .where(sf ? and(sf, eq(inspRecords.status, "failed")) : eq(inspRecords.status, "failed"))
    .groupBy(suppliers.name)
    .orderBy(sql`count(*) desc`)
    .limit(10);
  return rows.map((r) => ({ supplierName: r.supplierName, failures: Number(r.n) }));
}

const AGING_BUCKETS = ["0-7", "8-30", "31-60", "60+"] as const;

/** Aging of open FAIs (draft / in_inspection / awaiting_signoff), bucketed by days since creation. */
export async function agingOfOpenFais(db: Db, user: any, siteId: number | null) {
  await requirePerm(db, user);
  const sf = siteFilter(siteId);
  const rows = await db.select({ createdAt: inspRecords.createdAt })
    .from(inspRecords)
    .where(sf ? and(sf, inArray(inspRecords.status, ["draft", "in_inspection", "awaiting_signoff"])) : inArray(inspRecords.status, ["draft", "in_inspection", "awaiting_signoff"]));
  const now = Date.now();
  const counts: Record<(typeof AGING_BUCKETS)[number], number> = { "0-7": 0, "8-30": 0, "31-60": 0, "60+": 0 };
  for (const r of rows) {
    const days = r.createdAt ? Math.floor((now - r.createdAt.getTime()) / 86_400_000) : 0;
    if (days <= 7) counts["0-7"]++;
    else if (days <= 30) counts["8-30"]++;
    else if (days <= 60) counts["31-60"]++;
    else counts["60+"]++;
  }
  return AGING_BUCKETS.map((bucket) => ({ bucket, count: counts[bucket] }));
}
