import { and, asc, desc, eq, sql } from "drizzle-orm";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { whoAndWhen } from "../audit-trail/auditActor.js";
import { roleHasPermission } from "../roles/rolePermissions.js";
import { FAI_SCAN_PERMISSION, FAI_VIEW_PERMISSION, LABELS_PRINT_PERMISSION } from "../roles/roleAccess.js";
import { inspPlans, inspRecordSamples, inspRecords } from "../../drizzle/schema/faiInspection.js";
import { company } from "../../drizzle/schema/company.js";
import { DEFAULT_LABEL_SIZE, isLabelSizeId, labelSizeText, type LabelSizeId } from "../labels/labelSizes.js";

type Db = any;

const ENTITY = "FAI Inspection";
/** The largest AQL sample size is 2000 (code letter R), so no record has more samples than this. */
export const MAX_SAMPLES = 2000;

async function requirePerms(db: Db, user: any, permissions: string[], what: string) {
  const roleName = user?.role ?? user?.roleName;
  for (const permission of permissions) {
    if (!(await roleHasPermission(db, roleName, permission))) throw AppError.forbidden(`You don't have permission to ${what}.`);
  }
}

/* ---------------- Sample codes ---------------- */

/** <FAI number>-S<n>, for example FAI-0012-S03. At least two digits, more when a record has over 99 samples. */
export function sampleCodeFor(faiNumber: string, sampleNumber: number): string {
  return `${faiNumber}-S${String(sampleNumber).padStart(2, "0")}`;
}

/** A scanned sample tag back into its FAI number and sample number. Null when it does not look like one. */
export function parseSampleCode(code: string): { faiNumber: string; sampleNumber: number } | null {
  const match = /^(.+)-S(\d{1,4})$/i.exec(code.trim());
  if (!match) return null;
  const sampleNumber = Number(match[2]);
  return sampleNumber >= 1 ? { faiNumber: match[1]!, sampleNumber } : null;
}

/** How many samples this record has: the sample size entered on it, else the one the AQL table gave. */
export function sampleCountOf(rec: { sampleSize?: number | null; aqlSampleSize?: number | null }): number {
  const count = rec.sampleSize ?? rec.aqlSampleSize ?? 0;
  return Math.min(Math.max(0, count), MAX_SAMPLES);
}

async function loadRecord(db: Db, id: number) {
  const [rec] = await db.select().from(inspRecords).where(eq(inspRecords.id, id));
  if (!rec) throw AppError.notFound("FAI record not found.");
  return rec;
}

/* ---------------- Samples on a record ---------------- */

/** Every sample of a record with the code its tag carries and whether it was printed. Read access to FAI records is enough. */
export async function listSamples(db: Db, user: any, id: number) {
  await requirePerms(db, user, [FAI_VIEW_PERMISSION], "view FAI records");
  const rec = await loadRecord(db, id);
  const total = sampleCountOf(rec);
  const rows = await db.select().from(inspRecordSamples).where(eq(inspRecordSamples.recordId, id));
  const byNumber = new Map<number, any>(rows.map((row: any) => [row.sampleNumber, row]));
  const canPrint = await roleHasPermission(db, user?.role ?? user?.roleName, LABELS_PRINT_PERMISSION);
  return {
    faiNumber: rec.faiNumber,
    sampleCount: total,
    canPrint,
    samples: Array.from({ length: total }, (_, index) => {
      const number = index + 1;
      const row = byNumber.get(number);
      return { number, code: row?.code ?? sampleCodeFor(rec.faiNumber, number), printedCount: row?.printedCount ?? 0, lastPrintedAt: row?.lastPrintedAt ?? null };
    }),
  };
}

function labelDate(rec: any): string {
  return rec.datePulled || (rec.createdAt ? new Date(rec.createdAt).toISOString().slice(0, 10) : "");
}

/** What a label shows besides the sample: part, lot/PO, FAI number, date, and the company name from Settings. */
export async function labelData(db: Db, user: any, id: number) {
  await requirePerms(db, user, [FAI_VIEW_PERMISSION, LABELS_PRINT_PERMISSION], "print labels");
  const rec = await loadRecord(db, id);
  const [co] = await db.select({ name: company.name, profile: company.profile }).from(company).limit(1);
  const stored = co?.profile?.labelSize;
  return {
    faiNumber: rec.faiNumber,
    partNumber: rec.partNumber,
    lotReference: rec.poReference ?? "",
    lotSize: rec.lotSize ?? null,
    date: labelDate(rec),
    sampleCount: sampleCountOf(rec),
    companyName: co?.name ?? "",
    defaultSize: isLabelSizeId(stored) ? stored : DEFAULT_LABEL_SIZE,
  };
}

/**
 * Registers the tags being printed (a tag is the sample number plus its code, not an inventory record), counts the print
 * and writes the audit entry. The FAI record itself, its revision and its version are not touched.
 */
export async function printSampleLabels(db: Db, user: any, id: number, input: { samples: number[]; size: LabelSizeId }) {
  await requirePerms(db, user, [FAI_VIEW_PERMISSION, LABELS_PRINT_PERMISSION], "print labels");
  const rec = await loadRecord(db, id);
  const total = sampleCountOf(rec);
  if (total === 0) throw new AppError("Set the sample size on this FAI record before printing sample tags.", 409);
  const numbers = [...new Set(input.samples)].sort((a, b) => a - b);
  if (numbers.length === 0) throw AppError.badRequest("Choose at least one sample.");
  if (numbers.some((n) => !Number.isInteger(n) || n < 1 || n > total)) throw AppError.badRequest(`Choose samples from 1 to ${total}.`);

  const now = new Date();
  const labels: { number: number; code: string }[] = [];
  for (const number of numbers) {
    const [row] = await db
      .insert(inspRecordSamples)
      .values({ recordId: id, sampleNumber: number, code: sampleCodeFor(rec.faiNumber, number), printedCount: 1, lastPrintedAt: now, lastPrintedBy: user?.id ?? null })
      .onConflictDoUpdate({
        target: [inspRecordSamples.recordId, inspRecordSamples.sampleNumber],
        set: { printedCount: sql`${inspRecordSamples.printedCount} + 1`, lastPrintedAt: now, lastPrintedBy: user?.id ?? null },
      })
      .returning();
    labels.push({ number, code: row.code });
  }

  const { label, when } = await whoAndWhen(db, user?.id);
  const lot = rec.poReference ? `, PO ${rec.poReference}` : "";
  await recordAuditTrail(db, {
    entityType: ENTITY,
    entityId: id,
    action: "update",
    changes: {
      what: "sample tags",
      description: `${label} printed ${numbers.length} sample tag${numbers.length === 1 ? "" : "s"} for ${rec.faiNumber} (${rec.partNumber}${lot}, ${labelSizeText(input.size)} labels) on ${when}.`,
      samples: numbers,
      size: input.size,
    },
    performedBy: user?.id ?? null,
  });
  return { labels, count: labels.length };
}

/* ---------------- Scan to find ---------------- */

export interface FaiScanResult {
  type: "FAI plan" | "FAI record";
  id: number;
  label: string;
  detail: string;
  path: string;
  date: string | null;
}

/**
 * Scan to find for FAI & AQL. A sample-tag code opens its FAI record with that sample highlighted. A part number (or an
 * FAI number) lists that part's plans and FAI records, newest first. Needs "Can scan to find FAI" and read access to FAI records.
 */
export async function scanFai(db: Db, user: any, siteId: number | null, rawCode: string) {
  await requirePerms(db, user, [FAI_SCAN_PERMISSION, FAI_VIEW_PERMISSION], "scan to find FAI records");
  const code = rawCode.trim().slice(0, 120);
  if (!code) return { sample: null, results: [] as FaiScanResult[] };

  const onPlant = (column: any) => (siteId ? eq(column, siteId) : undefined);

  const [tag] = await db
    .select({ sampleNumber: inspRecordSamples.sampleNumber, code: inspRecordSamples.code, recordId: inspRecords.id, faiNumber: inspRecords.faiNumber, partNumber: inspRecords.partNumber })
    .from(inspRecordSamples)
    .innerJoin(inspRecords, eq(inspRecords.id, inspRecordSamples.recordId))
    .where(and(sql`lower(${inspRecordSamples.code}) = lower(${code})`, onPlant(inspRecords.siteId)));
  if (tag) {
    const rec = await loadRecord(db, tag.recordId);
    return {
      sample: { recordId: tag.recordId, faiNumber: tag.faiNumber, partNumber: tag.partNumber, sampleNumber: tag.sampleNumber, sampleCount: sampleCountOf(rec), code: tag.code, path: `/fai-inspection/records/${tag.recordId}?sample=${tag.sampleNumber}` },
      results: [] as FaiScanResult[],
    };
  }

  const plans = await db
    .select()
    .from(inspPlans)
    .where(and(sql`lower(${inspPlans.partNumber}) = lower(${code})`, onPlant(inspPlans.siteId)))
    .orderBy(desc(inspPlans.createdAt));
  const records = await db
    .select()
    .from(inspRecords)
    .where(and(sql`(lower(${inspRecords.partNumber}) = lower(${code}) OR lower(${inspRecords.faiNumber}) = lower(${code}))`, onPlant(inspRecords.siteId)))
    .orderBy(desc(inspRecords.createdAt), asc(inspRecords.id));

  const results: FaiScanResult[] = [
    ...plans.map((plan: any): FaiScanResult => ({
      type: "FAI plan",
      id: plan.id,
      label: `Plan: ${plan.partNumber}${plan.partDescription ? ` · ${plan.partDescription}` : ""}`,
      detail: `Revision ${plan.revision}, ${plan.status}`,
      path: `/fai-inspection/plans/${plan.id}`,
      date: plan.createdAt ? new Date(plan.createdAt).toISOString() : null,
    })),
    ...records.map((rec: any): FaiScanResult => ({
      type: "FAI record",
      id: rec.id,
      label: `${rec.faiNumber} · ${rec.partNumber}`,
      detail: [rec.poReference ? `PO ${rec.poReference}` : "", rec.status.replace(/_/g, " ")].filter(Boolean).join(", "),
      path: `/fai-inspection/records/${rec.id}`,
      date: rec.createdAt ? new Date(rec.createdAt).toISOString() : null,
    })),
  ].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return { sample: null, results };
}
