import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import type { DateRange } from "../reporting/reporting.service.js";
import type { ExportableReport } from "../reporting/reporting.export.js";
import { roleHasPermission } from "../roles/rolePermissions.js";
import { FAI_REPORTS_VIEW_PERMISSION } from "../roles/roleAccess.js";
import { inspApprovedSources, inspPlans, inspRecords, inspResultLines } from "../../drizzle/schema/faiInspection.js";
import { faiRandomPullBatches, faiRandomPullItems } from "../../drizzle/schema/faiScheduling.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { deny } from "./fai-inspection.service.js";

export interface FaiReportFilters extends DateRange {
  siteId?: number | null;
  supplierId?: number | null;
  partNumber?: string | null;
  productFamily?: string | null;
}

type ReportBody = Omit<ExportableReport, "generatedAt" | "generatedBy" | "companyName">;

async function requirePerm(db: Db, user: any) {
  const roleName = user?.role ?? user?.roleName;
  const allowed = await roleHasPermission(db, roleName, FAI_REPORTS_VIEW_PERMISSION);
  if (!allowed) await deny(db, user, FAI_REPORTS_VIEW_PERMISSION, "open FAI reports");
}

function recordConds(f: FaiReportFilters) {
  const conds = [];
  if (f.siteId) conds.push(eq(inspRecords.siteId, f.siteId));
  if (f.supplierId) conds.push(eq(inspRecords.supplierId, f.supplierId));
  if (f.partNumber) conds.push(eq(inspRecords.partNumber, f.partNumber));
  if (f.from) conds.push(gte(inspRecords.createdAt, f.from));
  if (f.to) conds.push(lte(inspRecords.createdAt, f.to));
  return conds;
}

/** Part numbers whose linked plan matches the product-family filter — insp_records has no productFamily column of its own, same loose join-by-part-number Phase 2's random-pull eligibility uses. */
async function partsInProductFamily(db: Db, productFamily: string): Promise<Set<string>> {
  const rows = await db.select({ partNumber: inspPlans.partNumber }).from(inspPlans).where(eq(inspPlans.productFamily, productFamily));
  return new Set(rows.map((r: any) => r.partNumber as string));
}

/** 1. AQL Lot Report — per FAI record: lot size, level/severity, code letter, sample size, Ac/Re per class, defects found, lot result. Reads stored values only — history never changes. */
export async function aqlLotReport(db: Db, user: any, f: FaiReportFilters): Promise<ReportBody> {
  await requirePerm(db, user);
  const conds = recordConds(f);
  let records = await db.select().from(inspRecords).where(conds.length ? and(...conds) : undefined);
  if (f.productFamily) {
    const parts = await partsInProductFamily(db, f.productFamily);
    records = records.filter((r: any) => parts.has(r.partNumber));
  }
  const recordIds = records.map((r: any) => r.id);
  const lines = recordIds.length ? await db.select().from(inspResultLines).where(inArray(inspResultLines.recordId, recordIds)) : [];
  const defectsByRecord = new Map<number, number>();
  for (const l of lines) defectsByRecord.set(l.recordId, (defectsByRecord.get(l.recordId) ?? 0) + (l.defects ?? 0));

  return {
    title: "AQL Lot Report",
    columns: ["FAI Number", "Part", "Lot Size", "Level", "Severity", "Code Letter", "Sample Size", "Ac/Re Major", "Ac/Re Minor", "Defects Found", "Lot Result"],
    rows: records.map((r: any) => [
      r.faiNumber, r.partNumber, r.lotSize ?? "", r.inspectionLevel ?? "", r.severity ?? "", r.codeLetter ?? "", r.aqlSampleSize ?? "",
      r.acMajor != null && r.reMajor != null ? `${r.acMajor}/${r.reMajor}` : "",
      r.acMinor != null && r.reMinor != null ? `${r.acMinor}/${r.reMinor}` : "",
      defectsByRecord.get(r.id) ?? 0,
      r.overallResult ?? r.status,
    ]),
  };
}

/** 2. Source Qualification Report — every Part + Supplier + factory + receiving location. */
export async function sourceQualificationReport(db: Db, user: any, f: FaiReportFilters): Promise<ReportBody> {
  await requirePerm(db, user);
  const conds = [];
  if (f.siteId) conds.push(eq(inspApprovedSources.siteId, f.siteId));
  if (f.supplierId) conds.push(eq(inspApprovedSources.supplierId, f.supplierId));
  if (f.partNumber) conds.push(eq(inspApprovedSources.partNumber, f.partNumber));
  let rows = await db.select().from(inspApprovedSources).where(conds.length ? and(...conds) : undefined);
  if (f.productFamily) {
    const parts = await partsInProductFamily(db, f.productFamily);
    rows = rows.filter((r: any) => parts.has(r.partNumber));
  }
  return {
    title: "Source Qualification Report",
    columns: ["Part", "Supplier Factory", "Receiving Location", "Status", "Last FAI", "Last Result", "Next Due"],
    rows: rows.map((r: any) => [r.partNumber, r.supplierFactory ?? "", r.receivingLocation ?? "", r.status, r.lastFaiDate ?? "", r.lastResult ?? "", r.nextDueDate ?? ""]),
  };
}

/** 3. Random Pull Compliance Report — by year, every picked item and its result. */
export async function randomPullComplianceReport(db: Db, user: any, f: FaiReportFilters): Promise<ReportBody> {
  await requirePerm(db, user);
  const batchConds = [eq(faiRandomPullBatches.status, "approved")];
  if (f.from) batchConds.push(gte(faiRandomPullBatches.generatedAt, f.from));
  if (f.to) batchConds.push(lte(faiRandomPullBatches.generatedAt, f.to));
  const batches = await db.select().from(faiRandomPullBatches).where(and(...batchConds));
  const batchIds = batches.map((b: any) => b.id);
  const batchYear = new Map(batches.map((b: any) => [b.id, b.year]));
  if (batchIds.length === 0) return { title: "Random Pull Compliance Report", columns: ["Year", "Part", "Supplier Factory", "Status", "Result"], rows: [] };

  const items = await db.select().from(faiRandomPullItems).where(inArray(faiRandomPullItems.batchId, batchIds));
  const sourceIds = items.map((i: any) => i.sourceId);
  const sources = sourceIds.length ? await db.select().from(inspApprovedSources).where(inArray(inspApprovedSources.id, sourceIds)) : [];
  const sourceById = new Map(sources.map((s: any) => [s.id, s]));
  const recordIds = items.map((i: any) => i.linkedRecordId).filter((id: number | null): id is number => id != null);
  const records = recordIds.length ? await db.select().from(inspRecords).where(inArray(inspRecords.id, recordIds)) : [];
  const recordById = new Map(records.map((r: any) => [r.id, r]));
  const currentYear = new Date().getFullYear();

  let rows = items.map((item: any) => {
    const source = sourceById.get(item.sourceId);
    const record = item.linkedRecordId ? recordById.get(item.linkedRecordId) : null;
    const year = batchYear.get(item.batchId);
    const status = !record ? (year < currentYear ? "Overdue" : "Pending") : record.status === "passed" || record.status === "failed" ? "Completed" : "In progress";
    const result = record?.overallResult ?? "";
    return { year, partNumber: source?.partNumber ?? "", supplierFactory: source?.supplierFactory ?? "", siteId: source?.siteId ?? null, status, result };
  });
  if (f.siteId) rows = rows.filter((r) => r.siteId === f.siteId);
  if (f.partNumber) rows = rows.filter((r) => r.partNumber === f.partNumber);

  return {
    title: "Random Pull Compliance Report",
    columns: ["Year", "Part", "Supplier Factory", "Status", "Result"],
    rows: rows.map((r) => [r.year, r.partNumber, r.supplierFactory, r.status, r.result]),
  };
}

/** 4. Supplier FAI Performance — per supplier: FAIs done, pass rate, failures, open items. */
export async function supplierFaiPerformanceReport(db: Db, user: any, f: FaiReportFilters): Promise<ReportBody> {
  await requirePerm(db, user);
  const conds = recordConds(f);
  let records = await db.select().from(inspRecords).where(conds.length ? and(...conds) : undefined);
  if (f.productFamily) {
    const parts = await partsInProductFamily(db, f.productFamily);
    records = records.filter((r: any) => parts.has(r.partNumber));
  }
  const supplierIds = [...new Set(records.map((r: any) => r.supplierId).filter((id: number | null): id is number => id != null))];
  const supplierRows = supplierIds.length ? await db.select().from(suppliers).where(inArray(suppliers.id, supplierIds)) : [];
  const nameById = new Map(supplierRows.map((s: any) => [s.id, s.name]));

  const bySupplier = new Map<number | "none", { done: number; passed: number; failed: number; open: number }>();
  for (const r of records) {
    const key = r.supplierId ?? "none";
    const bucket = bySupplier.get(key) ?? { done: 0, passed: 0, failed: 0, open: 0 };
    if (r.status === "passed") { bucket.done++; bucket.passed++; }
    else if (r.status === "failed") { bucket.done++; bucket.failed++; }
    else if (["draft", "in_inspection", "awaiting_signoff"].includes(r.status)) bucket.open++;
    bySupplier.set(key, bucket);
  }

  return {
    title: "Supplier FAI Performance",
    columns: ["Supplier", "FAIs Done", "Pass Rate %", "Failures", "Open Items"],
    rows: [...bySupplier.entries()].map(([key, b]) => [
      key === "none" ? "Unspecified" : nameById.get(key) ?? "Unknown supplier",
      b.done, b.done > 0 ? Math.round((b.passed / b.done) * 1000) / 10 : 0, b.failed, b.open,
    ]),
  };
}
