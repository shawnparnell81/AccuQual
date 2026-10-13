import { and, eq } from "drizzle-orm";
import { extractFileWithImages, type ExtractedImage } from "../form-import/extract.js";
import { proposeMonthlyQuality, toSupplierData } from "../form-import/reportTargets/monthlyQuality.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { users } from "../../drizzle/schema/users.js";
import { company } from "../../drizzle/schema/company.js";
import { formatUserLabel } from "../users/userDisplay.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "../../lib/requestDb.js";
import { AppError } from "../../utils/appError.js";
import { qualityEngineeringReports } from "../../drizzle/schema/qualityEngineeringReport.js";
import { readStoredRecipients } from "../../lib/reportRecipients.js";
import { deliverReportToEach, type ReportDelivery } from "../reporting/reportDelivery.js";
import { engineeringAccess, pullLive } from "./livePull.js";
import {
  assembleReport,
  emptyNarrative,
  emptySupplierData,
  MONTH_NAMES,
  mergeUploadNarrative,
  normalizeNarrative,
  type EngineeringNarrative,
  type EngineeringReportView,
  type NcrReportRow,
  type SupplierData,
} from "./model.js";
import { parseSupplierFile } from "./supplierParse.js";
import { deleteReportImageFiles, storeReportImages } from "./reportImages.js";
import { loadImportSources, resolveImportPulls } from "../import/import.archive.js";

const SAMPLE_NAME = "quality-engineering-supplier-august-2026.csv";
const MISSING_SAMPLE = "The sample supplier CSV is not included in this server build.";

function samplePath(): string {
  // Next to this module. `tsc` does not copy the CSV, so the API build script
  // places it under dist/ beside the compiled service. Render runs that dist.
  return join(dirname(fileURLToPath(import.meta.url)), "sample", SAMPLE_NAME);
}

export function readSupplierTemplate(path: string): { fileName: string; body: Buffer } {
  try {
    return { fileName: SAMPLE_NAME, body: readFileSync(path) };
  } catch (err) {
    const code = typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : "";
    if (code === "ENOENT") throw new AppError(MISSING_SAMPLE, 500);
    throw err;
  }
}

export function supplierTemplateFile(): { fileName: string; body: Buffer } {
  return readSupplierTemplate(samplePath());
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
    ncrTable: [],
  };
}

async function loadRow(db: Db, year: number, month: number) {
  const [row] = await db.select().from(qualityEngineeringReports).where(and(eq(qualityEngineeringReports.year, year), eq(qualityEngineeringReports.month, month)));
  return row ?? null;
}

/**
 * Upserts a month's narrative + supplier data and returns the assembled report. Shared by the
 * existing CSV/XLSX supplier upload and the generic "Import from file" report:monthly-quality
 * target (form-import/reportTargets/monthlyQuality.ts) — same write, same shape, so both paths
 * stay identical. Callers check engineeringAccess themselves first.
 */
export async function saveEngineeringSupplierData(
  db: Db,
  input: {
    year: number;
    month: number;
    narrative: EngineeringNarrative;
    supplierData: SupplierData;
    uploadFileName: string | null;
    user: { id: number; roleName: string | null; department: string | null };
    siteIds: number[];
    plantId?: number | null;
  },
): Promise<EngineeringReportView> {
  const now = new Date();
  await db
    .insert(qualityEngineeringReports)
    .values({
      year: input.year,
      month: input.month,
      narrative: input.narrative as unknown as Record<string, unknown>,
      supplierData: input.supplierData as unknown as Record<string, unknown>,
      uploadFileName: input.uploadFileName,
      createdBy: input.user.id,
      updatedBy: input.user.id,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [qualityEngineeringReports.year, qualityEngineeringReports.month],
      set: {
        narrative: input.narrative as unknown as Record<string, unknown>,
        supplierData: input.supplierData as unknown as Record<string, unknown>,
        uploadFileName: input.uploadFileName,
        updatedBy: input.user.id,
        updatedAt: now,
      },
    });
  return buildEngineeringReport(db, input);
}

export async function buildEngineeringReport(
  db: Db,
  input: {
    year: number;
    month: number;
    user: { id: number; roleName: string | null; department: string | null };
    siteIds: number[];
    plantId?: number | null;
  },
): Promise<EngineeringReportView> {
  const access = await engineeringAccess(db, input.user);
  if (!access.canRead) throw AppError.forbidden("You don't have access to the modules in this report.");
  const row = await loadRow(db, input.year, input.month);
  const live = await pullLive(db, { year: input.year, month: input.month, siteIds: input.siteIds, plantId: input.plantId ?? null, level: access.level });
  const narrative = normalizeNarrative(row?.narrative);
  const imported = await loadImportSources(db, narrative.importPulls, input.plantId ?? null);
  return assembleReport({
    year: input.year,
    month: input.month,
    narrative,
    supplier: asSupplier(row?.supplierData),
    live,
    saved: row != null,
    uploadFileName: row?.uploadFileName ?? null,
    canEdit: access.canEdit,
    recipients: readStoredRecipients(row?.recipients),
    importedDatasets: resolveImportPulls(narrative.importPulls, imported.sources),
    importsAvailable: imported.available,
  });
}

type Actor = { id: number; roleName: string | null; department: string | null };

/** Who is acting and when, as plain words for an audit entry. The time is in the company's time zone. */
async function actorLine(db: Db, userId: number): Promise<{ label: string; when: string }> {
  const [person] = await db.select({ name: users.name, email: users.email, isActive: users.isActive }).from(users).where(eq(users.id, userId));
  const [profile] = await db.select({ profile: company.profile }).from(company).limit(1);
  const timeZone = profile?.profile?.timezone || "UTC";
  const when = new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date());
  return { label: formatUserLabel(person ? { ...person, isActive: person.isActive ?? true } : undefined, userId), when };
}

function periodName(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** One plain-language audit entry on this month's report. `what` finishes the sentence "<person> ...". */
async function auditReport(db: Db, input: { year: number; month: number; userId: number; what: string; extra?: Record<string, unknown> }) {
  const row = await loadRow(db, input.year, input.month);
  if (!row) return;
  const { label, when } = await actorLine(db, input.userId);
  await recordAuditTrail(db, {
    entityType: "QualityEngineeringReport",
    entityId: row.id,
    action: "update",
    changes: { summary: `${label} ${input.what} on ${when}.`, ...(input.extra ?? {}) },
    performedBy: input.userId,
  });
}

const TEXT_LABELS: [keyof EngineeringNarrative, string][] = [
  ["departmentStatus", "Status of department"],
  ["primaryAchievement", "Primary achievement"],
  ["criticalRisk", "Critical risk"],
  ["payoutPolicy", "Payout policy"],
  ["rca", "Root cause analysis"],
  ["recommendation", "Recommendation"],
  ["productAlertNotes", "Product alert notes"],
  ["quarantineNotes", "Quarantine notes"],
  ["recallsNotes", "Recalls notes"],
  ["emailIssuesNotes", "Email Issues notes"],
  ["fieldQuestions", "Field questions"],
  ["palletNotes", "Pallet notes"],
  ["ncrNotes", "NCRs / CARs / PIRs / RPNs notes"],
];
const LIST_LABELS: [keyof EngineeringNarrative, string][] = [
  ["techLine", "NAPA Tech Line questions"],
  ["fitment", "Fitment questions"],
  ["productInfo", "Product information"],
  ["financialEntries", "Dollar entries"],
  ["importPulls", "Imported datasets"],
];

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function ncrRowChanges(before: NcrReportRow[], after: NcrReportRow[]): string | null {
  const common = Math.min(before.length, after.length);
  let edited = 0;
  for (let i = 0; i < common; i += 1) if (JSON.stringify(before[i]) !== JSON.stringify(after[i])) edited += 1;
  const added = Math.max(0, after.length - before.length);
  const deleted = Math.max(0, before.length - after.length);
  const parts = [added ? `${plural(added, "row")} added` : "", edited ? `${plural(edited, "row")} edited` : "", deleted ? `${plural(deleted, "row")} deleted` : ""].filter(Boolean);
  return parts.length ? `NCR table (from report): ${parts.join(", ")}` : null;
}

/** What a narrative save changed, as short labels. Empty when nothing changed. */
function narrativeChanges(before: EngineeringNarrative, after: EngineeringNarrative): string[] {
  const changed: string[] = [];
  for (const [key, label] of TEXT_LABELS) if (before[key] !== after[key]) changed.push(label);
  for (const [key, label] of LIST_LABELS) if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.push(label);
  const ncr = ncrRowChanges(before.ncrTableRows, after.ncrTableRows);
  if (ncr) changed.push(ncr);
  return changed;
}

/**
 * The narrative editor never owns the pictures (the import and the picture actions do), and an older
 * client that does not send the NCR fields leaves them as they were.
 */
function keepServerOwned(existing: EngineeringNarrative, incoming: EngineeringNarrative): EngineeringNarrative {
  return {
    ...incoming,
    ncrNotes: incoming.ncrNotes ?? existing.ncrNotes,
    ncrTableRows: incoming.ncrTableRows ?? existing.ncrTableRows,
    images: existing.images,
  };
}

export async function saveEngineeringNarrative(
  db: Db,
  input: {
    year: number;
    month: number;
    narrative: EngineeringNarrative;
    recipients?: string[];
    user: Actor;
    siteIds: number[];
    plantId?: number | null;
  },
): Promise<EngineeringReportView> {
  const access = await engineeringAccess(db, input.user);
  if (!access.canEdit) throw AppError.forbidden("This report is read-only for your access.");
  const before = normalizeNarrative((await loadRow(db, input.year, input.month))?.narrative);
  const narrative = keepServerOwned(before, input.narrative);
  const now = new Date();
  await db
    .insert(qualityEngineeringReports)
    .values({
      year: input.year,
      month: input.month,
      narrative: narrative as unknown as Record<string, unknown>,
      supplierData: emptySupplierData() as unknown as Record<string, unknown>,
      createdBy: input.user.id,
      updatedBy: input.user.id,
      updatedAt: now,
      ...(input.recipients !== undefined ? { recipients: input.recipients } : {}),
    })
    .onConflictDoUpdate({
      target: [qualityEngineeringReports.year, qualityEngineeringReports.month],
      set: {
        narrative: narrative as unknown as Record<string, unknown>,
        updatedBy: input.user.id,
        updatedAt: now,
        ...(input.recipients !== undefined ? { recipients: input.recipients } : {}),
      },
    });
  const changes = narrativeChanges(before, narrative);
  if (changes.length > 0) {
    await auditReport(db, { ...input, userId: input.user.id, what: `saved the ${periodName(input.year, input.month)} Monthly Quality Report (changed: ${changes.join("; ")})` });
  }
  return buildEngineeringReport(db, input);
}

/** What one file import filled in, for the audit sentence. */
export interface ImportSummary {
  ncrRows: number;
  ncrNotes: boolean;
  emailNotes: boolean;
  images: { added: number; removed: number; duplicates: number };
}

/** "the supplier file data, 2 NCR rows, NCR notes, Email Issues notes and 4 images" */
export function describeImport(summary: ImportSummary): string {
  const parts = ["the report data"];
  if (summary.ncrRows > 0) parts.push(plural(summary.ncrRows, "NCR row"));
  if (summary.ncrNotes) parts.push("NCR notes");
  if (summary.emailNotes) parts.push("Email Issues notes");
  if (summary.images.added > 0) parts.push(plural(summary.images.added, "image"));
  const head = parts.slice(0, -1).join(", ");
  const text = parts.length === 1 ? parts[0]! : `${head} and ${parts[parts.length - 1]}`;
  const extra = [summary.images.removed > 0 ? `${plural(summary.images.removed, "earlier image")} removed` : "", summary.images.duplicates > 0 ? `${plural(summary.images.duplicates, "duplicate image")} skipped` : ""].filter(Boolean);
  return extra.length ? `${text} (${extra.join(", ")})` : text;
}

/**
 * The one place a file import lands, for both the report's own upload and Import from file. Merges the
 * narrative (blank fields only, unless replace is ticked), saves the month's report row, then stores the
 * pictures as attachments of that row. Writes only this report and its pictures, never another module.
 * The caller writes the audit entry, because the two paths word it differently.
 */
export async function applyReportImport(
  db: Db,
  input: {
    year: number;
    month: number;
    supplierData: SupplierData;
    replaceNotes: boolean;
    fileName: string;
    images: ExtractedImage[];
    user: Actor;
    siteIds: number[];
    plantId?: number | null;
  },
): Promise<{ report: EngineeringReportView; summary: ImportSummary }> {
  const before = normalizeNarrative((await loadRow(db, input.year, input.month))?.narrative);
  const narrative = mergeUploadNarrative(before, input.supplierData, input.replaceNotes);
  let report = await saveEngineeringSupplierData(db, { ...input, narrative, supplierData: input.supplierData, uploadFileName: input.fileName.slice(0, 200) });
  const summary: ImportSummary = {
    ncrRows: input.supplierData.ncrTable.length > 0 && JSON.stringify(narrative.ncrTableRows) !== JSON.stringify(before.ncrTableRows) ? input.supplierData.ncrTable.length : 0,
    ncrNotes: narrative.ncrNotes !== before.ncrNotes,
    emailNotes: narrative.emailIssuesNotes !== before.emailIssuesNotes,
    images: { added: 0, removed: 0, duplicates: 0 },
  };
  if (input.images.length > 0) {
    const row = await loadRow(db, input.year, input.month);
    const stored = await storeReportImages(db, { reportId: row!.id, images: input.images, existing: narrative.images, replace: input.replaceNotes, uploadedBy: input.user.id });
    narrative.images = stored.images;
    await db
      .update(qualityEngineeringReports)
      .set({ narrative: narrative as unknown as Record<string, unknown> })
      .where(eq(qualityEngineeringReports.id, row!.id));
    summary.images = { added: stored.added, removed: stored.removed, duplicates: stored.duplicates };
    report = await buildEngineeringReport(db, input);
  }
  return { report, summary };
}

export async function uploadEngineeringSupplier(
  db: Db,
  input: {
    year: number;
    month: number;
    fileName: string;
    buffer: Buffer;
    replaceNotes: boolean;
    user: Actor;
    siteIds: number[];
    plantId?: number | null;
  },
): Promise<{ report: EngineeringReportView; warnings: string[] }> {
  const access = await engineeringAccess(db, input.user);
  if (!access.canEdit) throw AppError.forbidden("This report is read-only for your access.");
  const isDocx = /\.docx$/i.test(input.fileName);
  let supplierData: SupplierData;
  let warnings: string[];
  let images: ExtractedImage[] = [];
  if (isDocx) {
    // Same reader and rules as Import from file (no AI): Word headings, tables, text and pictures.
    const extracted = await extractFileWithImages(input.buffer, input.fileName);
    const { proposals, warnings: found } = proposeMonthlyQuality(extracted.file);
    supplierData = toSupplierData(Object.fromEntries(proposals.map((proposal) => [proposal.key, proposal.value])), input.year);
    warnings = found;
    images = extracted.images;
  } else {
    const parsed = await parseSupplierFile(input.buffer, input.fileName, input.year);
    supplierData = parsed.data;
    warnings = parsed.warnings;
  }
  const { report, summary } = await applyReportImport(db, { ...input, supplierData, images });
  await auditReport(db, {
    year: input.year,
    month: input.month,
    userId: input.user.id,
    what: `imported ${describeImport(summary)} into the ${periodName(input.year, input.month)} Monthly Quality Report from "${input.fileName}"${input.replaceNotes ? ", replacing text already typed" : ", keeping text already typed"}`,
    extra: { fileName: input.fileName },
  });
  return { report, warnings };
}

async function loadEditableRow(db: Db, input: { year: number; month: number; user: Actor }) {
  const access = await engineeringAccess(db, input.user);
  if (!access.canEdit) throw AppError.forbidden("This report is read-only for your access.");
  const row = await loadRow(db, input.year, input.month);
  if (!row) throw AppError.notFound("Report");
  return { row, narrative: normalizeNarrative(row.narrative) };
}

/** Edits the caption of one imported picture. Same edit access as the narrative save. */
export async function updateReportImageCaption(
  db: Db,
  input: { year: number; month: number; attachmentId: number; caption: string; user: Actor; siteIds: number[]; plantId?: number | null },
): Promise<EngineeringReportView> {
  const { row, narrative } = await loadEditableRow(db, input);
  const image = narrative.images.find((item) => item.attachmentId === input.attachmentId);
  if (!image) throw AppError.notFound("Picture");
  const before = image.caption;
  image.caption = input.caption;
  await db
    .update(qualityEngineeringReports)
    .set({ narrative: narrative as unknown as Record<string, unknown>, updatedBy: input.user.id, updatedAt: new Date() })
    .where(eq(qualityEngineeringReports.id, row.id));
  if (before !== input.caption) {
    await auditReport(db, { ...input, userId: input.user.id, what: `changed the caption of picture "${image.fileName}" in the ${periodName(input.year, input.month)} Monthly Quality Report from "${before || "no caption"}" to "${input.caption || "no caption"}"` });
  }
  return buildEngineeringReport(db, input);
}

/** Removes one imported picture (its attachment row and file) from the report. */
export async function deleteReportImage(
  db: Db,
  input: { year: number; month: number; attachmentId: number; user: Actor; siteIds: number[]; plantId?: number | null },
): Promise<EngineeringReportView> {
  const { row, narrative } = await loadEditableRow(db, input);
  const image = narrative.images.find((item) => item.attachmentId === input.attachmentId);
  if (!image) throw AppError.notFound("Picture");
  narrative.images = narrative.images.filter((item) => item.attachmentId !== input.attachmentId);
  await db
    .update(qualityEngineeringReports)
    .set({ narrative: narrative as unknown as Record<string, unknown>, updatedBy: input.user.id, updatedAt: new Date() })
    .where(eq(qualityEngineeringReports.id, row.id));
  await deleteReportImageFiles(db, row.id, [input.attachmentId]);
  await auditReport(db, { ...input, userId: input.user.id, what: `removed picture "${image.fileName}" from the ${periodName(input.year, input.month)} Monthly Quality Report` });
  return buildEngineeringReport(db, input);
}

function engineeringEmailCopy(report: EngineeringReportView): { subject: string; body: string } {
  const status = report.executive.departmentStatus || "not set";
  const lines = [report.title, `${report.documentId} Rev ${report.revision}`, `Department status: ${status}`];
  if (report.narrative.primaryAchievement.trim()) lines.push("", `Primary achievement: ${report.narrative.primaryAchievement.trim()}`);
  if (report.narrative.criticalRisk.trim()) lines.push("", `Critical risk: ${report.narrative.criticalRisk.trim()}`);
  lines.push("", "The full monthly report is in AccuQual under Reports, Quality / Engineering.");
  return { subject: `${report.title} (${report.documentId})`, body: lines.join("\n") };
}

/** Saves the recipient list (and narrative, when the editor sent one) and emails each address. */
export async function emailEngineeringReport(
  db: Db,
  input: {
    year: number;
    month: number;
    recipients: string[];
    narrative?: EngineeringNarrative;
    user: { id: number; roleName: string | null; department: string | null };
    siteIds: number[];
    plantId?: number | null;
  },
): Promise<{ report: EngineeringReportView; deliveries: ReportDelivery[] }> {
  const access = await engineeringAccess(db, input.user);
  if (!access.canEdit) throw AppError.forbidden("This report is read-only for your access.");
  if (input.recipients.length === 0) throw AppError.badRequest("Add at least one email address.");
  const narrativeToSave = input.narrative ? keepServerOwned(normalizeNarrative((await loadRow(db, input.year, input.month))?.narrative), input.narrative) : undefined;
  const now = new Date();
  await db
    .insert(qualityEngineeringReports)
    .values({
      year: input.year,
      month: input.month,
      narrative: (narrativeToSave ?? emptyNarrative()) as unknown as Record<string, unknown>,
      supplierData: emptySupplierData() as unknown as Record<string, unknown>,
      recipients: input.recipients,
      createdBy: input.user.id,
      updatedBy: input.user.id,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [qualityEngineeringReports.year, qualityEngineeringReports.month],
      set: {
        recipients: input.recipients,
        updatedBy: input.user.id,
        updatedAt: now,
        ...(narrativeToSave ? { narrative: narrativeToSave as unknown as Record<string, unknown> } : {}),
      },
    });
  const report = await buildEngineeringReport(db, input);
  const row = await loadRow(db, input.year, input.month);
  if (!row) throw new AppError("The report didn't save.", 500);
  const message = engineeringEmailCopy(report);
  const deliveries = await deliverReportToEach(db, {
    recipients: input.recipients,
    subject: message.subject,
    body: message.body,
    entityType: "QualityEngineeringReport",
    entityId: row.id,
    reportName: report.title,
    performedBy: input.user.id,
  });
  return { report, deliveries };
}
