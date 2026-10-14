/**
 * Stores monthly source rows. Rows are filed under the month of their own date, never under the month the
 * report was opened on. A re-upload updates rows by their key; within each source and month the file covers,
 * rows that are no longer in the file are removed, so a month is replaced and never counted twice.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { monthlySourceMonths, monthlySourceRows, monthlySourceUploads } from "../../drizzle/schema/monthlySourceRows.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { parseSourceWorkbook, SOURCE_LABELS, type SourceKind, type SourceRow, type SheetResult } from "./sourceParse.js";
import { sourceMonthFigures, type LogCount, type SourceMonthFigures, type StoredSourceRow } from "./sourceReport.js";
import type { SupplierData } from "./model.js";

export interface SourceKindSummary {
  source: SourceKind;
  label: string;
  rows: number;
  months: { month: string; rows: number; added: number; updated: number; removed: number }[];
}

export interface SourcePreview {
  fileName: string;
  sheets: SheetResult[];
  kinds: SourceKindSummary[];
  added: number;
  updated: number;
  removed: number;
  /** Rows dated in months whose report is already verified. They are not stored (that month is final). */
  skippedVerified: { month: string; rows: number }[];
}

async function verifiedMonths(db: Db): Promise<Set<string>> {
  const rows = await db.select({ month: monthlySourceMonths.month }).from(monthlySourceMonths);
  return new Set(rows.map((row) => row.month));
}

/** Drops rows of verified months and says how many were dropped per month. */
function withoutVerified(rows: SourceRow[], verified: Set<string>) {
  const skipped = new Map<string, number>();
  const kept = rows.filter((row) => {
    if (!verified.has(row.month)) return true;
    skipped.set(row.month, (skipped.get(row.month) ?? 0) + 1);
    return false;
  });
  return { kept, skipped: [...skipped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, count]) => ({ month, rows: count })) };
}

function group(rows: SourceRow[]): Map<SourceKind, Map<string, SourceRow[]>> {
  const out = new Map<SourceKind, Map<string, SourceRow[]>>();
  for (const row of rows) {
    const bySource = out.get(row.source) ?? new Map<string, SourceRow[]>();
    const list = bySource.get(row.month) ?? [];
    list.push(row);
    bySource.set(row.month, list);
    out.set(row.source, bySource);
  }
  return out;
}

/** What a commit would do, read from the stored rows. Writes nothing. */
async function plan(db: Db, fileName: string, rows: SourceRow[], sheets: SheetResult[], skippedVerified: SourcePreview["skippedVerified"]): Promise<SourcePreview> {
  const kinds: SourceKindSummary[] = [];
  let added = 0;
  let updated = 0;
  let removed = 0;
  for (const [source, months] of group(rows)) {
    const monthKeys = [...months.keys()].sort();
    const stored = await db
      .select({ rowKey: monthlySourceRows.rowKey, month: monthlySourceRows.month })
      .from(monthlySourceRows)
      .where(eq(monthlySourceRows.source, source));
    const storedKeys = new Set(stored.map((row) => row.rowKey));
    const incomingKeys = new Set(rows.filter((row) => row.source === source).map((row) => row.rowKey));
    const summary: SourceKindSummary = { source, label: SOURCE_LABELS[source], rows: incomingKeys.size, months: [] };
    for (const month of monthKeys) {
      const list = months.get(month)!;
      const add = list.filter((row) => !storedKeys.has(row.rowKey)).length;
      const gone = stored.filter((row) => row.month === month && !incomingKeys.has(row.rowKey)).length;
      summary.months.push({ month, rows: list.length, added: add, updated: list.length - add, removed: gone });
      added += add;
      updated += list.length - add;
      removed += gone;
    }
    kinds.push(summary);
  }
  return { fileName, sheets, kinds, added, updated, removed, skippedVerified };
}

export async function previewSourceFile(db: Db, input: { fileName: string; buffer: Buffer }): Promise<SourcePreview> {
  const parsed = await parseSourceWorkbook(input.buffer, input.fileName);
  const { kept, skipped } = withoutVerified(parsed.rows, await verifiedMonths(db));
  return plan(db, input.fileName, kept, parsed.sheets, skipped);
}

export async function commitSourceFile(db: Db, input: { fileName: string; buffer: Buffer; userId: number }): Promise<SourcePreview & { uploadId: number }> {
  // The workbook itself is only held in memory for this request; it is never written to storage.
  const workbook = await parseSourceWorkbook(input.buffer, input.fileName);
  const { kept, skipped } = withoutVerified(workbook.rows, await verifiedMonths(db));
  const parsed = { ...workbook, rows: kept };
  const preview = await plan(db, input.fileName, parsed.rows, parsed.sheets, skipped);
  const [upload] = await db
    .insert(monthlySourceUploads)
    .values({ fileName: input.fileName.slice(0, 255), summary: preview as unknown as Record<string, unknown>, uploadedBy: input.userId })
    .returning({ id: monthlySourceUploads.id });
  const uploadId = upload!.id;
  const now = new Date();
  for (const [source, months] of group(parsed.rows)) {
    const keys = parsed.rows.filter((row) => row.source === source).map((row) => row.rowKey);
    // Replace each covered month: drop that month's rows the file no longer lists.
    await db.delete(monthlySourceRows).where(
      and(
        eq(monthlySourceRows.source, source),
        inArray(monthlySourceRows.month, [...months.keys()]),
        sql`NOT (${monthlySourceRows.rowKey} = ANY(${sql.param(keys)}::text[]))`,
      ),
    );
    const list = parsed.rows.filter((row) => row.source === source);
    for (let start = 0; start < list.length; start += 500) {
      await db
        .insert(monthlySourceRows)
        .values(list.slice(start, start + 500).map((row) => ({ source, rowKey: row.rowKey, month: row.month, data: row.data, uploadId, updatedAt: now })))
        .onConflictDoUpdate({
          target: [monthlySourceRows.source, monthlySourceRows.rowKey],
          set: { month: sql`excluded.month`, data: sql`excluded.data`, uploadId, updatedAt: now },
        });
    }
  }
  const kinds = preview.kinds.map((kind) => `${kind.label} (${kind.rows} rows, ${kind.months.length} months)`).join("; ");
  await recordAuditTrail(db, {
    entityType: "MonthlySourceUpload",
    entityId: uploadId,
    action: "create",
    changes: {
      summary: `Monthly source file "${input.fileName}" imported: ${kinds}. ${preview.added} added, ${preview.updated} updated, ${preview.removed} removed.${skipped.length ? ` Skipped rows in verified months: ${skipped.map((item) => `${item.month} (${item.rows})`).join(", ")}.` : ""}`,
      fileName: input.fileName,
      added: preview.added,
      updated: preview.updated,
      removed: preview.removed,
      months: Object.fromEntries(preview.kinds.map((kind) => [kind.source, kind.months.map((month) => month.month)])),
    },
    performedBy: input.userId,
  });
  return { ...preview, uploadId };
}

export interface SourceCoverage {
  uploads: { id: number; fileName: string; createdAt: string | null; uploadedBy: number | null; added: number; updated: number; removed: number }[];
  coverage: { source: string; label: string; month: string; rows: number }[];
}

export async function listSourceCoverage(db: Db): Promise<SourceCoverage> {
  const uploads = await db.select().from(monthlySourceUploads).orderBy(desc(monthlySourceUploads.id)).limit(50);
  const counts = await db
    .select({ source: monthlySourceRows.source, month: monthlySourceRows.month, rows: sql<number>`count(*)::int` })
    .from(monthlySourceRows)
    .groupBy(monthlySourceRows.source, monthlySourceRows.month)
    .orderBy(monthlySourceRows.source, monthlySourceRows.month);
  return {
    uploads: uploads.map((upload) => {
      const summary = upload.summary as { added?: number; updated?: number; removed?: number };
      return {
        id: upload.id,
        fileName: upload.fileName,
        createdAt: upload.createdAt ? upload.createdAt.toISOString() : null,
        uploadedBy: upload.uploadedBy ?? null,
        added: summary.added ?? 0,
        updated: summary.updated ?? 0,
        removed: summary.removed ?? 0,
      };
    }),
    coverage: counts.map((row) => ({ ...row, label: SOURCE_LABELS[row.source as SourceKind] ?? row.source })),
  };
}

/** The report's figures from the stored rows of the window months. */
export async function loadSourceFigures(db: Db, window: string[], selected: string): Promise<SourceMonthFigures> {
  const kinds = await db
    .select({ source: monthlySourceRows.source, first: sql<string>`min(${monthlySourceRows.month})`, last: sql<string>`max(${monthlySourceRows.month})` })
    .from(monthlySourceRows)
    .groupBy(monthlySourceRows.source);
  const rows = kinds.length === 0 ? [] : await db.select({ source: monthlySourceRows.source, month: monthlySourceRows.month, data: monthlySourceRows.data }).from(monthlySourceRows).where(inArray(monthlySourceRows.month, window));
  const spans = new Map(kinds.map((row) => [row.source, { first: row.first, last: row.last }]));
  const computed = sourceMonthFigures(rows as StoredSourceRow[], window, selected, spans);
  const finals = await db.select().from(monthlySourceMonths).where(inArray(monthlySourceMonths.month, window));
  return finals.length === 0 ? computed : withVerifiedTotals(computed, finals.map((row) => ({ month: row.month, figures: row.figures as unknown as VerifiedFigures })), selected);
}

/** What a verified month keeps: its own figures (trend rows for that month, its detail, log counts). No row data. */
export interface VerifiedFigures {
  supplier: SupplierData;
  logs: SourceMonthFigures["logs"];
  techCalls?: SourceMonthFigures["techCalls"];
  kinds: string[];
  rowCounts: Record<string, number>;
}

/** Verified months read from their kept totals; their raw rows no longer exist. */
export function withVerifiedTotals(computed: SourceMonthFigures, finals: { month: string; figures: VerifiedFigures }[], selected: string): SourceMonthFigures {
  const supplier: SupplierData = {
    ...computed.supplier,
    monthlyMetrics: [...computed.supplier.monthlyMetrics],
    financials: [...computed.supplier.financials],
    warrantyMetrics: [...computed.supplier.warrantyMetrics],
  };
  let logs = computed.logs;
  let kinds = computed.kinds;
  let techCalls = computed.techCalls;
  for (const { month, figures } of finals) {
    const replace = <T extends { month: string }>(list: T[], from: T[]) => {
      const kept = list.filter((row) => row.month !== month);
      const own = from.find((row) => row.month === month);
      return own ? [...kept, own] : kept;
    };
    supplier.monthlyMetrics = replace(supplier.monthlyMetrics, figures.supplier.monthlyMetrics);
    supplier.financials = replace(supplier.financials, figures.supplier.financials);
    supplier.warrantyMetrics = replace(supplier.warrantyMetrics, figures.supplier.warrantyMetrics);
    if (month === selected) {
      const own = figures.supplier;
      Object.assign(supplier, {
        claimsSeries: own.claimsSeries,
        topParts: own.topParts,
        topVehicles: own.topVehicles,
        fuelPumpReturns: own.fuelPumpReturns,
        executive: own.executive,
        productAlerts: own.productAlerts,
        faiCategories: own.faiCategories,
        ncrTable: own.ncrTable,
      });
      logs = figures.logs;
      kinds = figures.kinds;
      techCalls = figures.techCalls ?? [];
    }
  }
  const order = (a: { month: string }, b: { month: string }) => a.month.localeCompare(b.month);
  supplier.monthlyMetrics.sort(order);
  supplier.financials.sort(order);
  supplier.warrantyMetrics.sort(order);
  return { supplier, logs, kinds, techCalls };
}

export async function isSourceMonthVerified(db: Db, month: string): Promise<{ verifiedAt: string | null; verifiedBy: number | null }> {
  const [row] = await db.select().from(monthlySourceMonths).where(eq(monthlySourceMonths.month, month));
  return { verifiedAt: row?.verifiedAt ? row.verifiedAt.toISOString() : null, verifiedBy: row?.verifiedBy ?? null };
}

/**
 * Finalizes one month's source data: keeps its totals, deletes its raw rows, and forgets upload records whose rows
 * are all gone. Caller checks permission and writes the audit entry.
 */
export async function finalizeSourceMonth(db: Db, month: string, userId: number): Promise<{ rowsDeleted: Record<string, number>; uploadsDeleted: string[]; alreadyVerified: boolean }> {
  const [existing] = await db.select({ month: monthlySourceMonths.month }).from(monthlySourceMonths).where(eq(monthlySourceMonths.month, month));
  if (existing) return { rowsDeleted: {}, uploadsDeleted: [], alreadyVerified: true };
  const kinds = await db
    .select({ source: monthlySourceRows.source, first: sql<string>`min(${monthlySourceRows.month})`, last: sql<string>`max(${monthlySourceRows.month})` })
    .from(monthlySourceRows)
    .groupBy(monthlySourceRows.source);
  const rows = await db.select({ source: monthlySourceRows.source, month: monthlySourceRows.month, data: monthlySourceRows.data }).from(monthlySourceRows).where(eq(monthlySourceRows.month, month));
  const figures = sourceMonthFigures(rows as StoredSourceRow[], [month], month, new Map(kinds.map((row) => [row.source, { first: row.first, last: row.last }])));
  const rowCounts: Record<string, number> = {};
  for (const row of rows) rowCounts[row.source] = (rowCounts[row.source] ?? 0) + 1;
  const kept: VerifiedFigures = { supplier: figures.supplier, logs: figures.logs, techCalls: figures.techCalls, kinds: figures.kinds, rowCounts };
  await db.insert(monthlySourceMonths).values({ month, figures: kept as unknown as Record<string, unknown>, verifiedBy: userId });
  await db.delete(monthlySourceRows).where(eq(monthlySourceRows.month, month));
  // An upload record lists a file name and counts only. Once none of its rows remain, drop the record too.
  const orphaned = await db
    .select({ id: monthlySourceUploads.id, fileName: monthlySourceUploads.fileName })
    .from(monthlySourceUploads)
    .where(sql`NOT EXISTS (SELECT 1 FROM monthly_source_rows r WHERE r.upload_id = ${monthlySourceUploads.id})`);
  if (orphaned.length > 0) await db.delete(monthlySourceUploads).where(inArray(monthlySourceUploads.id, orphaned.map((row) => row.id)));
  return { rowsDeleted: rowCounts, uploadsDeleted: orphaned.map((row) => row.fileName), alreadyVerified: false };
}

export type { LogCount };
