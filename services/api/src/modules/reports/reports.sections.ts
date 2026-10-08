import { and, eq, gte, lte, inArray, ne, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Db } from "../../lib/requestDb.js";
import type { ResourceKey } from "../../middleware/departmentAccess.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { canonicalNcrStep, ncrStepLabel } from "../ncr/ncr.workflow.js";
import { capa } from "../../drizzle/schema/capa.js";
import { sites } from "../../drizzle/schema/sites.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { qualityInspectionReports } from "../../drizzle/schema/qualityInspectionReports.js";
import { erpReceivingDocuments, erpReceivingLineItems } from "../../drizzle/schema/erp.js";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import { audits, auditItems } from "../../drizzle/schema/audits.js";
import { changeRequests } from "../../drizzle/schema/change.js";
import { isoQualityForms } from "../../drizzle/schema/isoQualityForms.js";
import { documents, documentVersions } from "../../drizzle/schema/documents.js";
import { documentChangeRequests } from "../../drizzle/schema/documentChangeRequests.js";
import { trainingAssignments } from "../../drizzle/schema/training.js";
import { equipment, calibrations } from "../../drizzle/schema/calibration.js";
import { ppapPackages } from "../../drizzle/schema/ppap.js";
import { workflowRuns } from "../../drizzle/schema/workflow.js";
import { AGING_LABELS, agingLabel, type ReportSection, type SectionKey, type SectionSpec } from "./reports.model.js";
import { plantDisplayName } from "../sites/siteAccess.js";

export interface SectionContext {
  db: Db;
  from: Date;
  to: Date;
  now: Date;
  siteIds: number[];
  present: Set<string>;
  can: (resource: ResourceKey) => boolean;
  /** "all" is an owner or administrator. "none" means the audit section is not filled. */
  visibleAudit: Set<string> | "all" | "none";
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round1(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

function pgCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  if ("code" in err && typeof (err as { code?: unknown }).code === "string") return (err as { code: string }).code;
  if ("cause" in err) return pgCode((err as { cause?: unknown }).cause);
  return null;
}

let guardSeq = 0;

/**
 * One section's queries sit in a savepoint. A missing table or column rolls
 * back only that section so the rest of the report still runs. Any other
 * error is rethrown and the request fails.
 */
export async function withReportGuard<T>(db: Db, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  const name = `report_guard_${++guardSeq}`;
  await db.execute(sql.raw(`SAVEPOINT ${name}`));
  try {
    const value = await fn();
    await db.execute(sql.raw(`RELEASE SAVEPOINT ${name}`));
    return { ok: true, value };
  } catch (err) {
    await db.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${name}`)).catch(() => undefined);
    await db.execute(sql.raw(`RELEASE SAVEPOINT ${name}`)).catch(() => undefined);
    const code = pgCode(err);
    if (code === "42P01") return { ok: false, reason: "A table this section needs is not in the database." };
    if (code === "42703") return { ok: false, reason: "A column this section needs is not in the database." };
    throw err;
  }
}

export async function loadPresentTables(db: Db): Promise<Set<string>> {
  const found = await db.execute(sql`
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  `);
  const names = new Set<string>();
  for (const row of (found.rows ?? []) as { name: string }[]) {
    if (row?.name) names.add(row.name);
  }
  return names;
}

function onSites(column: PgColumn, siteIds: number[]): SQL {
  if (siteIds.length === 0) return sql`false`;
  return inArray(column, siteIds);
}

function during(column: PgColumn, from: Date, to: Date): SQL {
  return and(gte(column, from), lte(column, to)) as SQL;
}

function section(spec: SectionSpec, summary: Record<string, number | string | null>, rows: ReportSection["rows"], reason?: string): ReportSection {
  return { key: spec.key, title: spec.title, status: "ok", summary, rows, ...(reason ? { reason } : {}) };
}

async function countFrom(query: Promise<{ count: number }[]>): Promise<number> {
  const [row] = await query;
  return num(row?.count);
}

function has(ctx: SectionContext, table: string): boolean {
  return ctx.present.has(table);
}

async function ncrSection(spec: SectionSpec, ctx: SectionContext): Promise<ReportSection> {
  const { db, from, to, siteIds } = ctx;
  const base = and(eq(ncr.isDeleted, false), onSites(ncr.siteId, siteIds));
  const openedWhere = and(base, during(ncr.createdAt, from, to));
  const closedWhere = and(base, during(ncr.closedAt, from, to));
  const openWhere = and(base, ne(ncr.status, "closed"));
  const opened = await countFrom(db.select({ count: sql<number>`count(*)::int` }).from(ncr).where(openedWhere));
  const closed = await countFrom(db.select({ count: sql<number>`count(*)::int` }).from(ncr).where(closedWhere));
  const openNow = await countFrom(db.select({ count: sql<number>`count(*)::int` }).from(ncr).where(openWhere));
  const highOpen = await countFrom(db.select({ count: sql<number>`count(*)::int` }).from(ncr).where(and(openWhere, inArray(ncr.severity, ["high", "critical"]))));
  const byStatus = await db
    .select({ key: sql<string>`coalesce(${ncr.status}, 'unspecified')`, count: sql<number>`count(*)::int` })
    .from(ncr)
    .where(openedWhere)
    .groupBy(sql`coalesce(${ncr.status}, 'unspecified')`);
  const bySeverity = await db
    .select({ key: sql<string>`coalesce(${ncr.severity}, 'unspecified')`, count: sql<number>`count(*)::int` })
    .from(ncr)
    .where(openedWhere)
    .groupBy(sql`coalesce(${ncr.severity}, 'unspecified')`);
  const byStep = new Map<string, number>();
  for (const row of byStatus) {
    const label = ncrStepLabel(canonicalNcrStep(row.key));
    byStep.set(label, (byStep.get(label) ?? 0) + num(row.count));
  }
  return section(spec, { opened, closed, openNow, highOrCriticalOpen: highOpen }, [
    ...[...byStep].map(([label, count]) => ({ label: `Opened · ${label}`, value: count })),
    ...bySeverity.map((row) => ({ label: `Severity · ${row.key}`, value: num(row.count) })),
  ]);
}

async function capaSection(spec: SectionSpec, ctx: SectionContext): Promise<ReportSection> {
  const { db, from, to, siteIds } = ctx;
  const base = onSites(capa.siteId, siteIds);
  const openedWhere = and(base, during(capa.createdAt, from, to));
  const closedWhere = and(base, during(capa.closedAt, from, to));
  const openWhere = and(base, ne(capa.status, "closed"));
  const opened = await countFrom(db.select({ count: sql<number>`count(*)::int` }).from(capa).where(openedWhere));
  const closed = await countFrom(db.select({ count: sql<number>`count(*)::int` }).from(capa).where(closedWhere));
  const openNow = await countFrom(db.select({ count: sql<number>`count(*)::int` }).from(capa).where(openWhere));
  const byStatus = await db
    .select({ key: sql<string>`coalesce(${capa.status}, 'unspecified')`, count: sql<number>`count(*)::int` })
    .from(capa)
    .where(openedWhere)
    .groupBy(sql`coalesce(${capa.status}, 'unspecified')`);
  return section(
    spec,
    { opened, closed, openNow, periodClosureRate: opened > 0 ? Math.round((closed / opened) * 1000) / 10 : null },
    byStatus.map((row) => ({ label: `Opened · ${row.key}`, value: num(row.count) })),
  );
}

async function trendCounts(ctx: SectionContext, kind: "ncr" | "capa"): Promise<Map<string, number>> {
  const grain = ctx.to.getTime() - ctx.from.getTime() > 62 * 86_400_000 ? "week" : "day";
  const column = kind === "ncr" ? ncr.createdAt : capa.createdAt;
  const table = kind === "ncr" ? ncr : capa;
  const siteColumn = kind === "ncr" ? ncr.siteId : capa.siteId;
  const bucket = grain === "week"
    ? sql<string>`to_char(date_trunc('week', ${column}), 'YYYY-MM-DD')`
    : sql<string>`to_char(date_trunc('day', ${column}), 'YYYY-MM-DD')`;
  const where = and(kind === "ncr" ? eq(ncr.isDeleted, false) : undefined, onSites(siteColumn, ctx.siteIds), during(column, ctx.from, ctx.to));
  const rows = await ctx.db.select({ bucket, count: sql<number>`count(*)::int` }).from(table).where(where).groupBy(sql`1`).orderBy(sql`1`);
  return new Map(rows.map((row) => [row.bucket, num(row.count)]));
}

async function issueTrendSection(spec: SectionSpec, ctx: SectionContext): Promise<ReportSection> {
  const grain = ctx.to.getTime() - ctx.from.getTime() > 62 * 86_400_000 ? "week" : "day";
  const ncrTrend = has(ctx, "ncr") && ctx.can("ncr") ? await trendCounts(ctx, "ncr") : null;
  const capaTrend = has(ctx, "capa") && ctx.can("capa") ? await trendCounts(ctx, "capa") : null;
  const labels = [...new Set([...(ncrTrend?.keys() ?? []), ...(capaTrend?.keys() ?? [])])].sort();
  const rows: ReportSection["rows"] = [];
  let ncrOpened = 0;
  let capaOpened = 0;
  for (const label of labels) {
    const ncrCount = ncrTrend?.get(label) ?? 0;
    const capaCount = capaTrend?.get(label) ?? 0;
    ncrOpened += ncrCount;
    capaOpened += capaCount;
    if (ncrTrend) rows.push({ label: `${label} · NCR`, value: ncrCount });
    if (capaTrend) rows.push({ label: `${label} · CAPA`, value: capaCount });
  }
  const notes: string[] = [];
  if (!ncrTrend) notes.push("NCR is not included.");
  if (!capaTrend) notes.push("CAPA is not included.");
  return section(
    spec,
    { grain, ncrOpened: ncrTrend ? ncrOpened : null, capaOpened: capaTrend ? capaOpened : null },
    rows,
    notes.length > 0 ? notes.join(" ") : undefined,
  );
}

async function agingBuckets(ctx: SectionContext, kind: "ncr" | "capa"): Promise<Map<string, number>> {
  const column = kind === "ncr" ? ncr.createdAt : capa.createdAt;
  const table = kind === "ncr" ? ncr : capa;
  const siteColumn = kind === "ncr" ? ncr.siteId : capa.siteId;
  const statusColumn = kind === "ncr" ? ncr.status : capa.status;
  const days = sql<number>`floor(extract(epoch from (${ctx.now}::timestamptz - ${column})) / 86400)::int`;
  const where = and(
    kind === "ncr" ? eq(ncr.isDeleted, false) : undefined,
    ne(statusColumn, "closed"),
    sql`${column} is not null`,
    onSites(siteColumn, ctx.siteIds),
  );
  const rows = await ctx.db.select({ days, count: sql<number>`count(*)::int` }).from(table).where(where).groupBy(sql`1`);
  const buckets = new Map<string, number>(AGING_LABELS.map((label) => [label, 0]));
  for (const row of rows) {
    const age = Math.max(0, num(row.days));
    const label = agingLabel(age);
    buckets.set(label, (buckets.get(label) ?? 0) + num(row.count));
  }
  return buckets;
}

async function agingSection(spec: SectionSpec, ctx: SectionContext): Promise<ReportSection> {
  const ncrAges = has(ctx, "ncr") && ctx.can("ncr") ? await agingBuckets(ctx, "ncr") : null;
  const capaAges = has(ctx, "capa") && ctx.can("capa") ? await agingBuckets(ctx, "capa") : null;
  const rows: ReportSection["rows"] = [];
  let openNcr = 0;
  let openCapa = 0;
  for (const label of AGING_LABELS) {
    if (ncrAges) {
      const value = ncrAges.get(label) ?? 0;
      openNcr += value;
      rows.push({ label: `NCR · ${label}`, value });
    }
    if (capaAges) {
      const value = capaAges.get(label) ?? 0;
      openCapa += value;
      rows.push({ label: `CAPA · ${label}`, value });
    }
  }
  return section(
    spec,
    {
      openNcr: ncrAges ? openNcr : null,
      openCapa: capaAges ? openCapa : null,
      asOf: ctx.now.toISOString(),
      definition: "Open means not closed. Bands match the dashboard.",
    },
    rows,
  );
}

async function plantSection(spec: SectionSpec, ctx: SectionContext): Promise<ReportSection> {
  const { db, from, to, siteIds } = ctx;
  if (siteIds.length === 0) {
    return section(spec, { plants: 0 }, [], "No plant is assigned, so there is nothing to compare.");
  }
  const plantRows = await db.select({ id: sites.id, name: sites.name, nameSnapshot: sites.nameSnapshot }).from(sites).where(inArray(sites.id, siteIds));
  const rows: ReportSection["rows"] = [];
  for (const plant of plantRows) {
    const plantName = plantDisplayName(plant);
    if (has(ctx, "ncr") && ctx.can("ncr")) {
      const opened = await countFrom(
        db.select({ count: sql<number>`count(*)::int` }).from(ncr).where(and(eq(ncr.isDeleted, false), eq(ncr.siteId, plant.id), during(ncr.createdAt, from, to))),
      );
      const openNow = await countFrom(
        db.select({ count: sql<number>`count(*)::int` }).from(ncr).where(and(eq(ncr.isDeleted, false), eq(ncr.siteId, plant.id), ne(ncr.status, "closed"))),
      );
      rows.push({ label: `${plantName} · NCR opened`, value: opened });
      rows.push({ label: `${plantName} · NCR open now`, value: openNow });
    }
    if (has(ctx, "capa") && ctx.can("capa")) {
      const opened = await countFrom(
        db.select({ count: sql<number>`count(*)::int` }).from(capa).where(and(eq(capa.siteId, plant.id), during(capa.createdAt, from, to))),
      );
      const openNow = await countFrom(
        db.select({ count: sql<number>`count(*)::int` }).from(capa).where(and(eq(capa.siteId, plant.id), ne(capa.status, "closed"))),
      );
      rows.push({ label: `${plantName} · CAPA opened`, value: opened });
      rows.push({ label: `${plantName} · CAPA open now`, value: openNow });
    }
  }
  return section(spec, { plants: plantRows.length }, rows);
}

async function supplierSection(spec: SectionSpec, ctx: SectionContext): Promise<ReportSection> {
  const { db, from, to, siteIds } = ctx;
  const byStatus = await db
    .select({ key: sql<string>`coalesce(${suppliers.status}, 'unspecified')`, count: sql<number>`count(*)::int` })
    .from(suppliers)
    .groupBy(sql`coalesce(${suppliers.status}, 'unspecified')`);
  const summary: Record<string, number | string | null> = { total: 0 };
  for (const row of byStatus) {
    const count = num(row.count);
    summary.total = num(summary.total) + count;
    summary[row.key] = count;
  }
  const rows: ReportSection["rows"] = byStatus.map((row) => ({ label: `Status · ${row.key}`, value: num(row.count) }));
  let reason: string | undefined;
  if (has(ctx, "ncr") && ctx.can("ncr")) {
    const linked = await db
      .select({ name: suppliers.name, count: sql<number>`count(*)::int` })
      .from(ncr)
      .innerJoin(suppliers, eq(suppliers.id, ncr.supplierId))
      .where(and(eq(ncr.isDeleted, false), sql`${ncr.supplierId} is not null`, onSites(ncr.siteId, siteIds), during(ncr.createdAt, from, to)))
      .groupBy(suppliers.name)
      .orderBy(sql`count(*) desc`)
      .limit(15);
    for (const row of linked) rows.push({ label: `${row.name} · NCRs opened`, value: num(row.count) });
  } else {
    reason = "NCR counts by supplier are left out.";
  }
  return section(spec, summary, rows, reason);
}

async function receivingSection(spec: SectionSpec, ctx: SectionContext): Promise<ReportSection> {
  const { db, from, to } = ctx;
  const summary: Record<string, number | string | null> = {};
  const rows: ReportSection["rows"] = [];
  const notes: string[] = [];
  const seeInspections = (ctx.can("quality_inspection") || ctx.can("inventory")) && has(ctx, "quality_inspection_reports");
  const seeReceipts = ctx.can("inventory") && (has(ctx, "erp_receiving_documents") || has(ctx, "erp_receiving_line_items"));
  if (!seeInspections && !seeReceipts) {
    return section(spec, {}, [], "Nothing in receiving is both present and visible with your access.");
  }
  if (seeInspections) {
    const where = during(qualityInspectionReports.createdAt, from, to);
    const total = await countFrom(db.select({ count: sql<number>`count(*)::int` }).from(qualityInspectionReports).where(where));
    const accepted = await countFrom(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(qualityInspectionReports)
        .where(and(where, inArray(qualityInspectionReports.finalStatus, ["accepted", "accepted_via_deviation"]))),
    );
    const rejected = await countFrom(
      db.select({ count: sql<number>`count(*)::int` }).from(qualityInspectionReports).where(and(where, eq(qualityInspectionReports.finalStatus, "rejected"))),
    );
    summary.inspections = total;
    summary.accepted = accepted;
    summary.rejected = rejected;
    const byStatus = await db
      .select({ key: sql<string>`coalesce(${qualityInspectionReports.finalStatus}, 'unspecified')`, count: sql<number>`count(*)::int` })
      .from(qualityInspectionReports)
      .where(where)
      .groupBy(sql`coalesce(${qualityInspectionReports.finalStatus}, 'unspecified')`);
    for (const row of byStatus) rows.push({ label: `Inspection · ${row.key}`, value: num(row.count) });
    notes.push("Inspections are company-wide. They are not split by plant.");
  }
  if (ctx.can("inventory") && has(ctx, "erp_receiving_documents")) {
    summary.receipts = await countFrom(
      db.select({ count: sql<number>`count(*)::int` }).from(erpReceivingDocuments).where(during(erpReceivingDocuments.createdAt, from, to)),
    );
  }
  if (ctx.can("inventory") && has(ctx, "erp_receiving_line_items")) {
    const byStatus = await db
      .select({ key: sql<string>`coalesce(${erpReceivingLineItems.status}, 'unspecified')`, count: sql<number>`count(*)::int` })
      .from(erpReceivingLineItems)
      .groupBy(sql`coalesce(${erpReceivingLineItems.status}, 'unspecified')`);
    let lines = 0;
    for (const row of byStatus) {
      const count = num(row.count);
      lines += count;
      rows.push({ label: `Line status now · ${row.key}`, value: count });
    }
    summary.receivingLines = lines;
    notes.push("Receiving line counts are the current status. Those rows have no received date.");
  }
  return section(spec, summary, rows, notes.join(" ") || undefined);
}

async function auditSection(spec: SectionSpec, ctx: SectionContext): Promise<ReportSection> {
  const { db, from, to, siteIds } = ctx;
  const summary: Record<string, number | string | null> = {};
  const rows: ReportSection["rows"] = [];
  const notes: string[] = [];
  if (has(ctx, "audit_trail") && ctx.visibleAudit !== "none") {
    const window = during(auditTrail.createdAt, from, to);
    const typeLimit = ctx.visibleAudit === "all" ? undefined : ctx.visibleAudit.size === 0 ? sql`false` : inArray(auditTrail.entityType, [...ctx.visibleAudit]);
    const where = typeLimit ? and(window, typeLimit) : window;
    summary.events = await countFrom(db.select({ count: sql<number>`count(*)::int` }).from(auditTrail).where(where));
    const grouped = await db
      .select({
        entityType: auditTrail.entityType,
        action: auditTrail.action,
        count: sql<number>`count(*)::int`,
      })
      .from(auditTrail)
      .where(where)
      .groupBy(auditTrail.entityType, auditTrail.action)
      .orderBy(sql`count(*) desc`)
      .limit(40);
    for (const row of grouped) rows.push({ label: `${row.entityType} · ${row.action}`, value: num(row.count) });
    notes.push("The audit trail is company-wide. It is limited to record types you can already read.");
  }
  if (has(ctx, "audits") && has(ctx, "audit_items") && ctx.can("audit")) {
    const where = and(during(auditItems.createdAt, from, to), onSites(audits.siteId, siteIds));
    const grouped = await db
      .select({ key: sql<string>`coalesce(${auditItems.severity}, 'unspecified')`, count: sql<number>`count(*)::int` })
      .from(auditItems)
      .innerJoin(audits, eq(audits.id, auditItems.auditId))
      .where(where)
      .groupBy(sql`coalesce(${auditItems.severity}, 'unspecified')`);
    let findings = 0;
    for (const row of grouped) {
      const count = num(row.count);
      findings += count;
      rows.push({ label: `Finding · ${row.key}`, value: count });
    }
    summary.findings = findings;
  } else if (!ctx.can("audit")) {
    notes.push("Audit findings are left out.");
  }
  return section(spec, summary, rows, notes.join(" ") || undefined);
}

async function engineeringSection(spec: SectionSpec, ctx: SectionContext): Promise<ReportSection> {
  const { db, from, to } = ctx;
  const summary: Record<string, number | string | null> = {};
  const rows: ReportSection["rows"] = [];
  const notes: string[] = ["Engineering changes are company-wide. They are not split by plant."];
  if (has(ctx, "change_requests")) {
    const openedWhere = during(changeRequests.createdAt, from, to);
    summary.opened = await countFrom(db.select({ count: sql<number>`count(*)::int` }).from(changeRequests).where(openedWhere));
    summary.openNow = await countFrom(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(changeRequests)
        .where(sql`${changeRequests.status} not in ('rejected', 'implemented')`),
    );
    const byStatus = await db
      .select({ key: sql<string>`coalesce(${changeRequests.status}, 'unspecified')`, count: sql<number>`count(*)::int` })
      .from(changeRequests)
      .where(openedWhere)
      .groupBy(sql`coalesce(${changeRequests.status}, 'unspecified')`);
    for (const row of byStatus) rows.push({ label: `Change · ${row.key}`, value: num(row.count) });
  }
  if (has(ctx, "iso_quality_forms")) {
    summary.engineeringChangeForms = await countFrom(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(isoQualityForms)
        .where(and(eq(isoQualityForms.formType, "engineering_change"), during(isoQualityForms.createdAt, from, to))),
    );
  }
  return section(spec, summary, rows, notes.join(" "));
}

async function documentSection(spec: SectionSpec, ctx: SectionContext): Promise<ReportSection> {
  const { db, from, to } = ctx;
  const summary: Record<string, number | string | null> = {};
  const rows: ReportSection["rows"] = [];
  if (has(ctx, "documents")) {
    const createdWhere = and(eq(documents.isDeleted, false), during(documents.createdAt, from, to));
    summary.created = await countFrom(db.select({ count: sql<number>`count(*)::int` }).from(documents).where(createdWhere));
    summary.revised = await countFrom(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(documents)
        .where(and(eq(documents.isDeleted, false), during(documents.updatedAt, from, to), sql`(${documents.createdAt} is null or ${documents.createdAt} < ${from})`)),
    );
    const byStatus = await db
      .select({ key: sql<string>`coalesce(${documents.status}, 'unspecified')`, count: sql<number>`count(*)::int` })
      .from(documents)
      .where(createdWhere)
      .groupBy(sql`coalesce(${documents.status}, 'unspecified')`);
    for (const row of byStatus) rows.push({ label: `Created · ${row.key}`, value: num(row.count) });
  }
  if (has(ctx, "document_change_requests")) {
    summary.changeRequests = await countFrom(
      db.select({ count: sql<number>`count(*)::int` }).from(documentChangeRequests).where(during(documentChangeRequests.createdAt, from, to)),
    );
  }
  if (has(ctx, "document_versions")) {
    summary.newVersions = await countFrom(
      db.select({ count: sql<number>`count(*)::int` }).from(documentVersions).where(during(documentVersions.createdAt, from, to)),
    );
  }
  return section(spec, summary, rows, "Documents are company-wide. They are not split by plant.");
}

async function trainingSection(spec: SectionSpec, ctx: SectionContext): Promise<ReportSection> {
  const { db, from, to, now } = ctx;
  const completed = await countFrom(
    db.select({ count: sql<number>`count(*)::int` }).from(trainingAssignments).where(during(trainingAssignments.completedAt, from, to)),
  );
  const overdue = await countFrom(
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(trainingAssignments)
      .where(sql`${trainingAssignments.status} = 'overdue' or (${trainingAssignments.dueAt} is not null and ${trainingAssignments.dueAt} < ${now} and ${trainingAssignments.status} <> 'completed')`),
  );
  const openAssignments = await countFrom(
    db.select({ count: sql<number>`count(*)::int` }).from(trainingAssignments).where(ne(trainingAssignments.status, "completed")),
  );
  const byStatus = await db
    .select({ key: sql<string>`coalesce(${trainingAssignments.status}, 'unspecified')`, count: sql<number>`count(*)::int` })
    .from(trainingAssignments)
    .groupBy(sql`coalesce(${trainingAssignments.status}, 'unspecified')`);
  return section(
    spec,
    { completedInPeriod: completed, overdue, openAssignments },
    byStatus.map((row) => ({ label: `Status · ${row.key}`, value: num(row.count) })),
    "Training is company-wide. Overdue is the current list, not limited to the date range.",
  );
}

async function calibrationSection(spec: SectionSpec, ctx: SectionContext): Promise<ReportSection> {
  const { db, from, to, now } = ctx;
  const summary: Record<string, number | string | null> = {};
  const rows: ReportSection["rows"] = [];
  if (has(ctx, "equipment")) {
    const byStatus = await db
      .select({ key: sql<string>`coalesce(${equipment.status}, 'unspecified')`, count: sql<number>`count(*)::int` })
      .from(equipment)
      .groupBy(sql`coalesce(${equipment.status}, 'unspecified')`);
    let gages = 0;
    for (const row of byStatus) {
      const count = num(row.count);
      gages += count;
      rows.push({ label: `Gage · ${row.key}`, value: count });
    }
    summary.gages = gages;
  }
  if (has(ctx, "calibrations")) {
    const window = sql`coalesce(${calibrations.completedAt}, ${calibrations.performedAt}) between ${from} and ${to}`;
    summary.completedInPeriod = await countFrom(db.select({ count: sql<number>`count(*)::int` }).from(calibrations).where(window));
    summary.failedInPeriod = await countFrom(
      db.select({ count: sql<number>`count(*)::int` }).from(calibrations).where(and(window, eq(calibrations.result, "fail"))),
    );
    if (has(ctx, "equipment")) {
      const overdue = await db.execute(sql`
        SELECT count(*)::int AS n
        FROM equipment e
        WHERE e.status = 'active'
          AND EXISTS (
            SELECT 1 FROM calibrations c
            WHERE c.equipment_id = e.id
              AND c.next_due_at IS NOT NULL
              AND c.next_due_at < ${now}
              AND c.id = (SELECT max(c2.id) FROM calibrations c2 WHERE c2.equipment_id = e.id)
          )
      `);
      summary.overdueGages = num((overdue.rows?.[0] as { n?: number } | undefined)?.n);
    }
  }
  return section(spec, summary, rows, "Gages are the equipment register. Counts cover the whole company.");
}

async function ppapSection(spec: SectionSpec, ctx: SectionContext): Promise<ReportSection> {
  const { db, from, to } = ctx;
  const openedWhere = during(ppapPackages.createdAt, from, to);
  const opened = await countFrom(db.select({ count: sql<number>`count(*)::int` }).from(ppapPackages).where(openedWhere));
  const openNow = await countFrom(
    db.select({ count: sql<number>`count(*)::int` }).from(ppapPackages).where(sql`${ppapPackages.status} not in ('approved', 'rejected')`),
  );
  const approved = await countFrom(
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(ppapPackages)
      .where(and(eq(ppapPackages.status, "approved"), during(ppapPackages.createdAt, from, to))),
  );
  const byStatus = await db
    .select({ key: sql<string>`coalesce(${ppapPackages.status}, 'unspecified')`, count: sql<number>`count(*)::int` })
    .from(ppapPackages)
    .where(openedWhere)
    .groupBy(sql`coalesce(${ppapPackages.status}, 'unspecified')`);
  return section(
    spec,
    { opened, openNow, approvedInPeriod: approved },
    byStatus.map((row) => ({ label: `Opened · ${row.key}`, value: num(row.count) })),
    "PPAP packages have no plant column, so this section is company-wide.",
  );
}

async function cycleSection(spec: SectionSpec, ctx: SectionContext): Promise<ReportSection> {
  const { db, from, to, siteIds } = ctx;
  const summary: Record<string, number | string | null> = {};
  const rows: ReportSection["rows"] = [];
  if (has(ctx, "ncr") && ctx.can("ncr")) {
    const [row] = await db
      .select({ avgDays: sql<number | null>`avg(extract(epoch from (${ncr.closedAt} - ${ncr.createdAt})) / 86400)` })
      .from(ncr)
      .where(and(eq(ncr.isDeleted, false), eq(ncr.status, "closed"), onSites(ncr.siteId, siteIds), during(ncr.closedAt, from, to)));
    summary.ncrAvgDays = round1(row?.avgDays);
  }
  if (has(ctx, "capa") && ctx.can("capa")) {
    const [row] = await db
      .select({ avgDays: sql<number | null>`avg(extract(epoch from (${capa.closedAt} - ${capa.createdAt})) / 86400)` })
      .from(capa)
      .where(and(eq(capa.status, "closed"), onSites(capa.siteId, siteIds), during(capa.closedAt, from, to)));
    summary.capaAvgDays = round1(row?.avgDays);
  }
  if (has(ctx, "workflow_runs") && ctx.can("workflow")) {
    const where = and(eq(workflowRuns.simulated, false), during(workflowRuns.startedAt, from, to));
    const [row] = await db
      .select({
        avgDays: sql<number | null>`avg(extract(epoch from (${workflowRuns.finishedAt} - ${workflowRuns.startedAt})) / 86400) filter (where ${workflowRuns.finishedAt} is not null)`,
      })
      .from(workflowRuns)
      .where(where);
    summary.workflowAvgDays = round1(row?.avgDays);
    const byStatus = await db
      .select({ key: sql<string>`coalesce(${workflowRuns.status}, 'unspecified')`, count: sql<number>`count(*)::int` })
      .from(workflowRuns)
      .where(where)
      .groupBy(sql`coalesce(${workflowRuns.status}, 'unspecified')`);
    for (const status of byStatus) rows.push({ label: `Run · ${status.key}`, value: num(status.count) });
  }
  return section(spec, summary, rows, "Cycle time is creation to close, in days, for records that finished in this range.");
}

const LOADERS: Record<SectionKey, (spec: SectionSpec, ctx: SectionContext) => Promise<ReportSection>> = {
  ncr: ncrSection,
  capa: capaSection,
  issue_trend: issueTrendSection,
  aging: agingSection,
  plant_comparison: plantSection,
  supplier: supplierSection,
  receiving: receivingSection,
  audit_trail: auditSection,
  engineering_changes: engineeringSection,
  document_activity: documentSection,
  training: trainingSection,
  calibration: calibrationSection,
  ppap: ppapSection,
  workflow_cycle_times: cycleSection,
};

export async function loadReportSection(spec: SectionSpec, ctx: SectionContext): Promise<ReportSection> {
  const loader = LOADERS[spec.key];
  return loader(spec, ctx);
}
