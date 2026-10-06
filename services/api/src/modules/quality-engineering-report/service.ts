import { and, eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "../../lib/requestDb.js";
import { AppError } from "../../utils/appError.js";
import { qualityEngineeringReports } from "../../drizzle/schema/qualityEngineeringReport.js";
import { engineeringAccess, pullLive } from "./livePull.js";
import {
  assembleReport,
  emptySupplierData,
  mergeUploadNarrative,
  normalizeNarrative,
  type EngineeringNarrative,
  type EngineeringReportView,
  type SupplierData,
} from "./model.js";
import { parseSupplierFile } from "./supplierParse.js";

const SAMPLE_NAME = "quality-engineering-supplier-august-2026.csv";

function samplePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "sample", SAMPLE_NAME);
}

export function supplierTemplateFile(): { fileName: string; body: Buffer } {
  return { fileName: SAMPLE_NAME, body: readFileSync(samplePath()) };
}

function asSupplier(value: unknown): SupplierData {
  const blank = emptySupplierData();
  if (!value || typeof value !== "object") return blank;
  const row = value as Partial<SupplierData>;
  return {
    monthlyMetrics: Array.isArray(row.monthlyMetrics) ? row.monthlyMetrics : [],
    financials: Array.isArray(row.financials) ? row.financials : [],
    warrantyMetrics: Array.isArray(row.warrantyMetrics) ? row.warrantyMetrics : [],
    claimsSeries: Array.isArray(row.claimsSeries) ? row.claimsSeries : [],
    topParts: Array.isArray(row.topParts) ? row.topParts : [],
    topVehicles: Array.isArray(row.topVehicles) ? row.topVehicles : [],
    fuelPumpReturns: Array.isArray(row.fuelPumpReturns) ? row.fuelPumpReturns : [],
    executive: row.executive && typeof row.executive === "object" ? row.executive : {},
    productAlerts: row.productAlerts ?? null,
    faiCategories: Array.isArray(row.faiCategories) ? row.faiCategories : [],
    emailIssues: Array.isArray(row.emailIssues) ? row.emailIssues : [],
    notes: Array.isArray(row.notes) ? row.notes : [],
  };
}

async function loadRow(db: Db, year: number, month: number) {
  const [row] = await db.select().from(qualityEngineeringReports).where(and(eq(qualityEngineeringReports.year, year), eq(qualityEngineeringReports.month, month)));
  return row ?? null;
}

export async function buildEngineeringReport(
  db: Db,
  input: {
    year: number;
    month: number;
    user: { id: number; roleName: string | null; department: string | null };
    siteIds: number[];
  },
): Promise<EngineeringReportView> {
  const access = await engineeringAccess(db, input.user);
  if (!access.canRead) throw AppError.forbidden("You don't have access to the modules in this report.");
  const row = await loadRow(db, input.year, input.month);
  const live = await pullLive(db, { year: input.year, month: input.month, siteIds: input.siteIds, level: access.level });
  return assembleReport({
    year: input.year,
    month: input.month,
    narrative: normalizeNarrative(row?.narrative),
    supplier: asSupplier(row?.supplierData),
    live,
    saved: row != null,
    uploadFileName: row?.uploadFileName ?? null,
    canEdit: access.canEdit,
  });
}

export async function saveEngineeringNarrative(
  db: Db,
  input: {
    year: number;
    month: number;
    narrative: EngineeringNarrative;
    user: { id: number; roleName: string | null; department: string | null };
    siteIds: number[];
  },
): Promise<EngineeringReportView> {
  const access = await engineeringAccess(db, input.user);
  if (!access.canEdit) throw AppError.forbidden("This report is read-only for your access.");
  const now = new Date();
  await db
    .insert(qualityEngineeringReports)
    .values({
      year: input.year,
      month: input.month,
      narrative: input.narrative as unknown as Record<string, unknown>,
      supplierData: emptySupplierData() as unknown as Record<string, unknown>,
      createdBy: input.user.id,
      updatedBy: input.user.id,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [qualityEngineeringReports.year, qualityEngineeringReports.month],
      set: { narrative: input.narrative as unknown as Record<string, unknown>, updatedBy: input.user.id, updatedAt: now },
    });
  return buildEngineeringReport(db, input);
}

export async function uploadEngineeringSupplier(
  db: Db,
  input: {
    year: number;
    month: number;
    fileName: string;
    buffer: Buffer;
    replaceNotes: boolean;
    user: { id: number; roleName: string | null; department: string | null };
    siteIds: number[];
  },
): Promise<{ report: EngineeringReportView; warnings: string[] }> {
  const access = await engineeringAccess(db, input.user);
  if (!access.canEdit) throw AppError.forbidden("This report is read-only for your access.");
  const parsed = await parseSupplierFile(input.buffer, input.fileName, input.year);
  const existing = await loadRow(db, input.year, input.month);
  const narrative = mergeUploadNarrative(normalizeNarrative(existing?.narrative), parsed.data, input.replaceNotes);
  const now = new Date();
  await db
    .insert(qualityEngineeringReports)
    .values({
      year: input.year,
      month: input.month,
      narrative: narrative as unknown as Record<string, unknown>,
      supplierData: parsed.data as unknown as Record<string, unknown>,
      uploadFileName: input.fileName.slice(0, 200),
      createdBy: input.user.id,
      updatedBy: input.user.id,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [qualityEngineeringReports.year, qualityEngineeringReports.month],
      set: {
        narrative: narrative as unknown as Record<string, unknown>,
        supplierData: parsed.data as unknown as Record<string, unknown>,
        uploadFileName: input.fileName.slice(0, 200),
        updatedBy: input.user.id,
        updatedAt: now,
      },
    });
  const report = await buildEngineeringReport(db, input);
  return { report, warnings: parsed.warnings };
}
