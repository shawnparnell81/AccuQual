import { AppError } from "../../utils/appError.js";
import type { ResourceKey } from "../../middleware/departmentAccess.js";

/**
 * Version 1 of the quality report document. The API serves this catalog as
 * JSON (`GET /reports/templates`). There is no separate reporting warehouse:
 * each section is filled from the module table that already owns the records.
 */
export const REPORT_TEMPLATE_VERSION = 1;

export type ReportKind = "weekly" | "monthly" | "adhoc";

export type SectionKey =
  | "ncr"
  | "capa"
  | "issue_trend"
  | "aging"
  | "plant_comparison"
  | "supplier"
  | "receiving"
  | "audit_trail"
  | "engineering_changes"
  | "document_activity"
  | "training"
  | "calibration"
  | "ppap"
  | "workflow_cycle_times";

export type SectionStatus = "ok" | "skipped" | "no_access";

/** Same bands as the dashboard aging chart (dashboard.metrics.ts). */
export const AGING_LABELS = ["0–7d", "8–30d", "31–60d", "60d+"] as const;

export function agingLabel(days: number): (typeof AGING_LABELS)[number] {
  if (days <= 7) return "0–7d";
  if (days <= 30) return "8–30d";
  if (days <= 60) return "31–60d";
  return "60d+";
}

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 366;

export interface SectionSpec {
  key: SectionKey;
  title: string;
  /** Weekly reports include "weekly". Monthly and custom reports include both. */
  cadence: "weekly" | "monthly";
  /**
   * The person needs read access to one of these modules. "reader" means
   * they already cleared that bar for some other section (or for audits).
   */
  access: ResourceKey[] | "reader";
  /** Every one of these tables must exist. */
  allTables: string[];
  /** At least one of these tables must exist. Empty means no extra requirement. */
  anyTables: string[];
}

export const SECTION_SPECS: readonly SectionSpec[] = [
  { key: "ncr", title: "NCR", cadence: "weekly", access: ["ncr"], allTables: ["ncr"], anyTables: [] },
  { key: "capa", title: "CAPA", cadence: "weekly", access: ["capa"], allTables: ["capa"], anyTables: [] },
  { key: "issue_trend", title: "Issue trend", cadence: "weekly", access: ["ncr", "capa"], allTables: [], anyTables: ["ncr", "capa"] },
  { key: "aging", title: "Aging of open work", cadence: "weekly", access: ["ncr", "capa"], allTables: [], anyTables: ["ncr", "capa"] },
  { key: "plant_comparison", title: "Plant comparison", cadence: "weekly", access: ["ncr", "capa"], allTables: ["sites"], anyTables: ["ncr", "capa"] },
  { key: "supplier", title: "Suppliers", cadence: "weekly", access: ["suppliers"], allTables: ["suppliers"], anyTables: [] },
  {
    key: "receiving",
    title: "Receiving",
    cadence: "weekly",
    access: ["inventory", "quality_inspection"],
    allTables: [],
    anyTables: ["quality_inspection_reports", "erp_receiving_documents", "erp_receiving_line_items"],
  },
  { key: "audit_trail", title: "Audit trail", cadence: "weekly", access: "reader", allTables: [], anyTables: ["audit_trail", "audits"] },
  {
    key: "engineering_changes",
    title: "Engineering changes",
    cadence: "weekly",
    access: ["change"],
    allTables: [],
    anyTables: ["change_requests", "iso_quality_forms"],
  },
  {
    key: "document_activity",
    title: "Document activity",
    cadence: "weekly",
    access: ["documents"],
    allTables: [],
    anyTables: ["documents", "document_change_requests", "document_versions"],
  },
  { key: "training", title: "Training", cadence: "monthly", access: ["training"], allTables: [], anyTables: ["training_assignments"] },
  { key: "calibration", title: "Calibration and gages", cadence: "monthly", access: ["calibration"], allTables: [], anyTables: ["equipment", "calibrations"] },
  { key: "ppap", title: "PPAP", cadence: "monthly", access: ["ppap"], allTables: ["ppap_packages"], anyTables: [] },
  {
    key: "workflow_cycle_times",
    title: "Workflow cycle times",
    cadence: "monthly",
    access: ["workflow", "ncr", "capa"],
    allTables: [],
    anyTables: ["workflow_runs", "ncr", "capa"],
  },
];

const TITLES: Record<ReportKind, string> = {
  weekly: "Weekly quality report",
  monthly: "Monthly quality report",
  adhoc: "Custom quality report",
};

export function isReportKind(value: string): value is ReportKind {
  return value === "weekly" || value === "monthly" || value === "adhoc";
}

export function templateFor(kind: ReportKind): SectionSpec[] {
  if (kind === "weekly") return SECTION_SPECS.filter((spec) => spec.cadence === "weekly");
  return [...SECTION_SPECS];
}

export interface ReportTemplateDocument {
  version: number;
  templates: Array<{
    key: ReportKind;
    title: string;
    header: string[];
    sections: Array<{ key: SectionKey; title: string }>;
  }>;
}

const HEADER_FIELDS = ["type", "dateRange", "plant", "generatedAt", "generatedBy"];

/** The versioned template catalog, ready to send as JSON. */
export function reportTemplateDocument(): ReportTemplateDocument {
  const kinds: ReportKind[] = ["weekly", "monthly", "adhoc"];
  return {
    version: REPORT_TEMPLATE_VERSION,
    templates: kinds.map((key) => ({
      key,
      title: TITLES[key],
      header: HEADER_FIELDS,
      sections: templateFor(key).map((spec) => ({ key: spec.key, title: spec.title })),
    })),
  };
}

export function reportTitle(kind: ReportKind): string {
  return TITLES[kind];
}

export interface ReportSection {
  key: SectionKey;
  title: string;
  status: SectionStatus;
  reason?: string;
  summary: Record<string, number | string | null>;
  rows: Array<{ label: string; value: number | string | null }>;
}

export interface QualityReport {
  header: {
    templateVersion: number;
    templateKey: ReportKind;
    type: ReportKind;
    title: string;
    dateRange: { from: string; to: string };
    plant: { id: number | null; name: string; scope: "plant" | "all" };
    generatedAt: string;
    generatedBy: { id: number; name: string };
  };
  sections: ReportSection[];
  delivery: {
    pdf: { status: "stub"; message: string };
    email: { status: "stub"; message: string };
  };
}

export const PDF_STUB_MESSAGE = "Download the PDF from the export route. This run does not attach the file.";
export const EMAIL_STUB_MESSAGE = "Scheduled email is not turned on. Run a report here and download CSV or JSON.";

export function deliveryStubs(): QualityReport["delivery"] {
  return {
    pdf: { status: "stub", message: PDF_STUB_MESSAGE },
    email: { status: "stub", message: EMAIL_STUB_MESSAGE },
  };
}

export function emptySection(spec: SectionSpec, status: SectionStatus, reason: string): ReportSection {
  return { key: spec.key, title: spec.title, status, reason, summary: {}, rows: [] };
}

export function sectionAllows(spec: SectionSpec, can: (resource: ResourceKey) => boolean, reader: boolean): boolean {
  if (spec.access === "reader") return reader;
  return spec.access.some((resource) => can(resource));
}

export function tablesReady(spec: SectionSpec, present: Set<string>): boolean {
  if (!spec.allTables.every((name) => present.has(name))) return false;
  if (spec.anyTables.length > 0 && !spec.anyTables.some((name) => present.has(name))) return false;
  return true;
}

export interface DateWindow {
  from: Date;
  to: Date;
}

function utcStart(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
}

function utcEnd(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
}

function parseDay(value: string, edge: "start" | "end"): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw AppError.badRequest("Dates must be YYYY-MM-DD.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = edge === "start" ? utcStart(year, month - 1, day) : utcEnd(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw AppError.badRequest("That date is not a real calendar day.");
  }
  return date;
}

function assertSpan(from: Date, to: Date): void {
  if (from.getTime() > to.getTime()) throw AppError.badRequest("The start date is after the end date.");
  const days = (to.getTime() - from.getTime()) / DAY_MS;
  if (days > MAX_RANGE_DAYS) throw AppError.badRequest("Choose a date range of one year or less.");
}

/** Weekly is the last 7 days. Monthly is the calendar month so far. Custom dates are required for ad hoc. */
export function resolveRange(kind: ReportKind, from: string | undefined, to: string | undefined, now: Date): DateWindow {
  if ((from && !to) || (!from && to)) throw AppError.badRequest("Provide both a start date and an end date.");
  if (from && to) {
    const window = { from: parseDay(from, "start"), to: parseDay(to, "end") };
    assertSpan(window.from, window.to);
    return window;
  }
  if (kind === "adhoc") throw AppError.badRequest("A custom report needs a start date and an end date.");
  if (kind === "weekly") {
    const toDate = utcEnd(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const start = new Date(toDate.getTime() - 6 * DAY_MS);
    return { from: utcStart(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()), to: toDate };
  }
  return {
    from: utcStart(now.getUTCFullYear(), now.getUTCMonth(), 1),
    to: utcEnd(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  };
}

export interface PlantChoice {
  siteIds: number[];
  plant: { id: number | null; name: string; scope: "plant" | "all" };
}

export function resolvePlant(input: {
  plantId: number | "all" | undefined;
  allowedSiteIds: number[];
  currentSiteId: number | null;
  sites: { id: number; name: string }[];
}): PlantChoice {
  const names = new Map(input.sites.map((site) => [site.id, site.name]));
  const allowed = input.allowedSiteIds;

  let chosen: number | "all";
  if (input.plantId === "all") chosen = "all";
  else if (typeof input.plantId === "number") chosen = input.plantId;
  else if (input.currentSiteId != null && names.has(input.currentSiteId)) chosen = input.currentSiteId;
  else chosen = "all";

  if (typeof chosen === "number" && !allowed.includes(chosen)) {
    throw AppError.forbidden("You aren't assigned to that plant.");
  }
  if (typeof chosen === "number" && !names.has(chosen)) {
    throw AppError.badRequest("That plant was deleted.");
  }

  if (chosen === "all") {
    return { siteIds: allowed, plant: { id: null, name: "All plants", scope: "all" } };
  }
  return {
    siteIds: [chosen],
    plant: { id: chosen, name: names.get(chosen) ?? `Plant #${chosen}`, scope: "plant" },
  };
}

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One flat sheet: the header as comment lines, then every summary and breakdown row. */
export function reportToCsv(report: QualityReport): string {
  const header = report.header;
  const comments = [
    `# ${header.title}`,
    `# Type: ${header.type}`,
    `# Template: ${header.templateVersion}`,
    `# From: ${header.dateRange.from}`,
    `# To: ${header.dateRange.to}`,
    `# Plant: ${header.plant.name}`,
    `# Generated: ${header.generatedAt} by ${header.generatedBy.name}`,
    "",
  ];
  const lines = ["section,title,status,label,value"];
  for (const section of report.sections) {
    if (section.status !== "ok") {
      lines.push([section.key, section.title, section.status, "reason", section.reason ?? ""].map(csvCell).join(","));
      continue;
    }
    for (const [label, value] of Object.entries(section.summary)) {
      lines.push([section.key, section.title, section.status, label, value].map(csvCell).join(","));
    }
    for (const row of section.rows) {
      lines.push([section.key, section.title, section.status, row.label, row.value].map(csvCell).join(","));
    }
  }
  return [...comments, ...lines].join("\n");
}

export function reportFileName(kind: ReportKind, format: "csv" | "json" | "pdf"): string {
  const day = new Date().toISOString().slice(0, 10);
  return `accuqual-${kind}-report-${day}.${format}`;
}
