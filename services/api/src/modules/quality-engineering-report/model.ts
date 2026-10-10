/** Shapes for the Quality / Engineering monthly report. Labor and warranty dollars come from AccuQual. */

export const DOCUMENT_ID = "TMP-ENG-001";
export const DOCUMENT_REVISION = "C";
export const DOCUMENT_TITLE = "Monthly Engineering Development Report";

import { normalizeFinancialEntries, resolveMonthMoney, type BookGate, type FinancialEntry, type MoneySource } from "./financials.js";

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

export type DepartmentStatus = "" | "green" | "yellow" | "red";

export interface QaItem {
  problem: string;
  response: string;
}

export interface EngineeringNarrative {
  departmentStatus: DepartmentStatus;
  primaryAchievement: string;
  criticalRisk: string;
  payoutPolicy: string;
  rca: string;
  recommendation: string;
  productAlertNotes: string;
  quarantineNotes: string;
  recallsNotes: string;
  emailIssuesNotes: string;
  fieldQuestions: string;
  palletNotes: string;
  techLine: QaItem[];
  fitment: QaItem[];
  productInfo: QaItem[];
  /** Company-typed dollars for a month that has no Labor Claim or Warranty cost yet. */
  financialEntries: FinancialEntry[];
  /** Fields summed from a chosen imported file. The value is labeled with that import. */
  importPulls: ImportPull[];
}

export const IMPORT_PULL_SECTIONS = ["returns", "warranty", "labor", "financials"] as const;
export type ImportPullSection = (typeof IMPORT_PULL_SECTIONS)[number];

export interface ImportPull {
  importId: number;
  section: ImportPullSection;
  field: string;
}

export interface ImportedDatasetLine {
  importId: number;
  section: ImportPullSection;
  field: string;
  fieldLabel: string;
  total: number | null;
  source: string;
  missing: boolean;
}

export interface MonthMetric {
  month: string;
  totalClaims: number | null;
  totalProductAlerts: number | null;
}

export interface FinancialMonth {
  month: string;
  totalAmount: number | null;
  partsAmount: number | null;
  laborAmount: number | null;
}

export interface WarrantyMonth {
  month: string;
  laborToPartsRatio: string | null;
  mttfDays: number | null;
  medianDays: number | null;
}

export interface ClaimPoint {
  date: string;
  claims: number;
  returns: number;
}

export interface TopPart {
  partNumber: string;
  description: string;
  totalClaims: number;
}

export interface TopVehicle {
  vehicle: string;
  claims: number;
}

export interface NamedCount {
  source: string;
  count: number;
}

export interface ProductAlertSummary {
  total: number | null;
  open: number | null;
  hoursSpent: number | null;
  avgDaysToClose: number | null;
}

export interface FaiCategoryRow {
  category: string;
  totalCompleted: number;
  passed: number;
  failed: number;
  passedWithDeviation: number;
}

export interface EmailIssueMonth {
  month: string;
  totalIssues: number | null;
  orIssues: number | null;
  napaIssues: number | null;
}

export interface SupplierNote {
  section: string;
  problem: string;
  response: string;
}

export interface SupplierData {
  monthlyMetrics: MonthMetric[];
  financials: FinancialMonth[];
  warrantyMetrics: WarrantyMonth[];
  claimsSeries: ClaimPoint[];
  topParts: TopPart[];
  topVehicles: TopVehicle[];
  fuelPumpReturns: NamedCount[];
  /** Raw supplier keys (department_status, raw_claim_count, flat_rate, ...). */
  executive: Record<string, string>;
  productAlerts: ProductAlertSummary | null;
  faiCategories: FaiCategoryRow[];
  emailIssues: EmailIssueMonth[];
  notes: SupplierNote[];
}

export type Gated<T> = { status: "ok"; data: T } | { status: "no_access" } | { status: "unavailable"; reason: string };

export interface NcrRow {
  id: number;
  number: string;
  partNumber: string;
  description: string;
  disposition: string;
  status: string;
}

export interface QuarantineRow {
  id: number;
  label: string;
  quantity: string;
  reason: string;
  status: string;
}

export interface LivePull {
  ncr: Gated<{ total: number; open: number; closed: number; rows: NcrRow[] }>;
  cars: Gated<{ scar: number | null; capa: number | null }>;
  rpn: Gated<{ count: number }>;
  quarantine: Gated<{ rows: QuarantineRow[] }>;
  productAlertDocuments: Gated<{ count: number }>;
  recallDocuments: Gated<{ count: number }>;
  fai: Gated<{ rows: FaiCategoryRow[]; open: number }>;
  laborBooks: BookGate;
  warrantyBooks: BookGate;
}

export interface EngineeringReportView {
  documentId: typeof DOCUMENT_ID;
  revision: typeof DOCUMENT_REVISION;
  documentTitle: typeof DOCUMENT_TITLE;
  title: string;
  year: number;
  month: number;
  monthName: string;
  saved: boolean;
  uploadFileName: string | null;
  canEdit: boolean;
  /** Inboxes that receive this saved report. */
  recipients: string[];
  importedDatasets: ImportedDatasetLine[];
  importsAvailable: boolean;
  narrative: EngineeringNarrative;
  executive: {
    departmentStatus: DepartmentStatus;
    primaryAchievement: string;
    criticalRisk: string;
    rawClaimCount: number | null;
    trackerProcessed: number | null;
    fuelPumpReturns: NamedCount[];
    totalAmountRequested: number | null;
    partsAmountRequested: number | null;
    laborAmountRequested: number | null;
    potentialLiability: number | null;
    potentialLiabilityDerived: boolean;
    flatRate: number | null;
    claimsDenied: number | null;
    claimsApproved: number | null;
    claimsPending: number | null;
    deniedLaborSavings: number | null;
    deniedLaborSavingsDerived: boolean;
    payoutPolicy: string;
  };
  tables: {
    months: { key: string; label: string }[];
    metrics: { totalClaims: Array<number | null>; totalProductAlerts: Array<number | null> };
    financials: {
      total: Array<number | null>;
      parts: Array<number | null>;
      labor: Array<number | null>;
      totalSource: MoneySource[];
      partsSource: MoneySource[];
      laborSource: MoneySource[];
      totalEditable: boolean[];
      partsEditable: boolean[];
      laborEditable: boolean[];
    };
    warranty: { ratio: Array<string | null>; mttfDays: Array<number | null>; medianDays: Array<number | null> };
    topParts: TopPart[];
    fai: { source: "supplier" | "accuqual" | "none"; rows: FaiCategoryRow[]; inAppOpen: number | null };
  };
  charts: {
    /** month = points in the selected month. file = the upload had dates, none in that month. */
    claimsSeriesScope: "month" | "file" | "empty";
    claimsReturns: ClaimPoint[];
    fuelPumpReturns: NamedCount[];
    topVehicles: TopVehicle[];
    emailIssues: Array<{ month: string; label: string; totalIssues: number | null; orIssues: number | null; napaIssues: number | null }>;
  };
  labor: { mttfDays: number | null; medianDays: number | null };
  claimMonth: {
    laborCount: number | null;
    laborHours: number | null;
    laborCost: number | null;
    warrantyCount: number | null;
    warrantyCost: number | null;
  };
  productAlerts: ProductAlertSummary & { documentCount: Gated<{ count: number }> };
  sections: {
    quarantineNotes: string;
    recallsNotes: string;
    emailIssuesNotes: string;
    fieldQuestions: string;
    palletNotes: string;
    rca: string;
    recommendation: string;
    productAlertNotes: string;
    techLine: QaItem[];
    fitment: QaItem[];
    productInfo: QaItem[];
    pir: { status: "not_tracked"; note: string };
  };
  live: LivePull;
}

export function emptyNarrative(): EngineeringNarrative {
  return {
    departmentStatus: "",
    primaryAchievement: "",
    criticalRisk: "",
    payoutPolicy: "",
    rca: "",
    recommendation: "",
    productAlertNotes: "",
    quarantineNotes: "",
    recallsNotes: "",
    emailIssuesNotes: "",
    fieldQuestions: "",
    palletNotes: "",
    techLine: [],
    fitment: [],
    productInfo: [],
    financialEntries: [],
    importPulls: [],
  };
}

export function emptySupplierData(): SupplierData {
  return {
    monthlyMetrics: [],
    financials: [],
    warrantyMetrics: [],
    claimsSeries: [],
    topParts: [],
    topVehicles: [],
    fuelPumpReturns: [],
    executive: {},
    productAlerts: null,
    faiCategories: [],
    emailIssues: [],
    notes: [],
  };
}

export function emptyLive(): LivePull {
  const unavailable = { status: "unavailable" as const, reason: "Not loaded." };
  return {
    ncr: unavailable,
    cars: unavailable,
    rpn: unavailable,
    quarantine: unavailable,
    productAlertDocuments: unavailable,
    recallDocuments: unavailable,
    fai: unavailable,
    laborBooks: unavailable,
    warrantyBooks: unavailable,
  };
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function monthLabel(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return key;
  const month = Number(match[2]);
  const name = MONTH_NAMES[month - 1];
  return name ? `${name.slice(0, 3)} ${match[1]}` : key;
}

/** Six calendar months ending at the report month, oldest first. */
export function monthWindow(year: number, month: number, count = 6): string[] {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - i, 1));
    keys.push(monthKey(date.getUTCFullYear(), date.getUTCMonth() + 1));
  }
  return keys;
}

export function monthBounds(year: number, month: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

export function money(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function executiveNumber(executive: Record<string, string>, key: string): number | null {
  const raw = executive[key];
  if (raw == null || raw.trim() === "") return null;
  const cleaned = raw.replace(/[$,]/g, "").trim();
  if (!cleaned || /^n\/?a$/i.test(cleaned) || cleaned === "—" || cleaned === "-") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function classifyFai(status: string, overall: string | null, failureDetected: string | null): "passed" | "failed" | "deviation" | "open" {
  const blob = `${status} ${overall ?? ""}`.toLowerCase();
  if (blob.includes("deviation")) return "deviation";
  if (/\bfail|\breject/.test(blob) || failureDetected?.trim().toLowerCase() === "yes") return "failed";
  if (/\bpass|\bapprov/.test(blob)) return "passed";
  return "open";
}

export function faiCategory(productFamily: string, partText: string): string {
  const blob = `${productFamily} ${partText}`.toLowerCase();
  if (/brake/.test(blob) && /sensor|wear/.test(blob)) return "Brake Wear Sensors";
  if (/\bcsa\b|strut|shock/.test(blob)) return "CSAs & Shocks";
  if (/fuel|lift/.test(blob)) return "Fuel & Lift Supports";
  const family = productFamily.trim();
  return family || "Other";
}

function textOf(notes: SupplierNote[], section: string): string {
  return notes
    .filter((note) => note.section === section)
    .map((note) => note.problem.trim())
    .filter(Boolean)
    .join("\n\n");
}

function qaOf(notes: SupplierNote[], section: string): QaItem[] {
  return notes
    .filter((note) => note.section === section && (note.problem.trim() || note.response.trim()))
    .map((note) => ({ problem: note.problem.trim(), response: note.response.trim() }));
}

/** Fills blank narrative from the upload. A replace flag overwrites text the user already saved. */
export function mergeUploadNarrative(current: EngineeringNarrative, supplier: SupplierData, replaceNotes: boolean): EngineeringNarrative {
  const next: EngineeringNarrative = {
    ...current,
    techLine: current.techLine.map((item) => ({ ...item })),
    fitment: current.fitment.map((item) => ({ ...item })),
    productInfo: current.productInfo.map((item) => ({ ...item })),
  };
  const fillText = (key: "primaryAchievement" | "criticalRisk" | "payoutPolicy" | "rca" | "recommendation" | "productAlertNotes" | "quarantineNotes" | "recallsNotes" | "emailIssuesNotes" | "fieldQuestions" | "palletNotes", section: string) => {
    const text = textOf(supplier.notes, section);
    if (!text) return;
    if (replaceNotes || !next[key].trim()) next[key] = text;
  };
  const fillQa = (key: "techLine" | "fitment" | "productInfo", section: string) => {
    const items = qaOf(supplier.notes, section);
    if (items.length === 0) return;
    if (replaceNotes || next[key].length === 0) next[key] = items;
  };
  fillText("primaryAchievement", "primary_achievement");
  fillText("criticalRisk", "critical_risk");
  fillText("payoutPolicy", "payout_policy");
  fillText("rca", "rca");
  fillText("recommendation", "recommendation");
  fillText("productAlertNotes", "product_alert_notes");
  fillText("quarantineNotes", "quarantine");
  fillText("recallsNotes", "recalls");
  fillText("emailIssuesNotes", "email_issues");
  fillText("fieldQuestions", "field_question");
  fillText("palletNotes", "pallet");
  fillQa("techLine", "tech_line");
  fillQa("fitment", "fitment");
  fillQa("productInfo", "product_info");
  const status = supplier.executive.department_status?.trim().toLowerCase();
  if ((replaceNotes || !next.departmentStatus) && (status === "green" || status === "yellow" || status === "red")) {
    next.departmentStatus = status;
  }
  return next;
}

function byMonth<T extends { month: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.month, row]));
}

function addFai(rows: FaiCategoryRow[]): FaiCategoryRow[] {
  if (rows.length === 0) return [];
  const total = rows.reduce(
    (sum, row) => ({
      category: "Total",
      totalCompleted: sum.totalCompleted + row.totalCompleted,
      passed: sum.passed + row.passed,
      failed: sum.failed + row.failed,
      passedWithDeviation: sum.passedWithDeviation + row.passedWithDeviation,
    }),
    { category: "Total", totalCompleted: 0, passed: 0, failed: 0, passedWithDeviation: 0 },
  );
  const withoutTotal = rows.filter((row) => row.category.trim().toLowerCase() !== "total");
  return [...withoutTotal, total];
}

export function assembleReport(input: {
  year: number;
  month: number;
  narrative: EngineeringNarrative;
  supplier: SupplierData;
  live: LivePull;
  saved: boolean;
  uploadFileName: string | null;
  canEdit: boolean;
  recipients?: string[];
  importedDatasets?: ImportedDatasetLine[];
  importsAvailable?: boolean;
}): EngineeringReportView {
  const { year, month, narrative, supplier, live } = input;
  const selected = monthKey(year, month);
  const months = monthWindow(year, month);
  const metrics = byMonth(supplier.monthlyMetrics);
  const warranty = byMonth(supplier.warrantyMetrics);
  const selectedWarranty = warranty.get(selected);
  const selectedMetrics = metrics.get(selected);
  const entries = new Map(narrative.financialEntries.map((entry) => [entry.month, entry]));
  const moneyRows = months.map((key) =>
    resolveMonthMoney({
      month: key,
      labor: live.laborBooks,
      warranty: live.warrantyBooks,
      entry: entries.get(key),
    }),
  );
  const selectedMoney = moneyRows[moneyRows.length - 1] ?? resolveMonthMoney({ month: selected, labor: live.laborBooks, warranty: live.warrantyBooks });

  const rawClaimCount = executiveNumber(supplier.executive, "raw_claim_count");
  const flatRate = executiveNumber(supplier.executive, "flat_rate");
  const claimsDenied = executiveNumber(supplier.executive, "claims_denied");
  const givenLiability = executiveNumber(supplier.executive, "potential_liability");
  const givenSavings = executiveNumber(supplier.executive, "denied_labor_savings");
  const potentialLiabilityDerived = givenLiability == null && rawClaimCount != null && flatRate != null;
  const deniedLaborSavingsDerived = givenSavings == null && claimsDenied != null && flatRate != null;

  const ratioFor = (index: number): string | null => {
    const moneyRow = moneyRows[index];
    if (!moneyRow || moneyRow.labor.value == null || moneyRow.warranty.value == null || moneyRow.warranty.value === 0) return null;
    const ratio = Math.round((moneyRow.labor.value / moneyRow.warranty.value) * 100) / 100;
    return `${ratio}:1`;
  };

  const monthBook = (gate: BookGate) => {
    if (gate.status !== "ok") return null;
    return gate.months.find((row) => row.month === selected) ?? { month: selected, count: 0, hours: 0, cost: null as number | null };
  };
  const laborBook = monthBook(live.laborBooks);
  const warrantyBook = monthBook(live.warrantyBooks);

  const supplierFai = supplier.faiCategories.length > 0;
  const inAppFai = live.fai.status === "ok" ? live.fai.data : null;
  const faiRows = supplierFai ? addFai(supplier.faiCategories) : inAppFai && inAppFai.rows.length > 0 ? addFai(inAppFai.rows) : [];

  const claimsReturns = supplier.claimsSeries.filter((point) => point.date.startsWith(selected));
  const emailByMonth = byMonth(supplier.emailIssues);

  return {
    documentId: DOCUMENT_ID,
    revision: DOCUMENT_REVISION,
    documentTitle: DOCUMENT_TITLE,
    title: `Monthly Quality Report — ${MONTH_NAMES[month - 1]} ${year}`,
    year,
    month,
    monthName: MONTH_NAMES[month - 1] ?? String(month),
    saved: input.saved,
    uploadFileName: input.uploadFileName,
    canEdit: input.canEdit,
    recipients: input.recipients ?? [],
    importedDatasets: input.importedDatasets ?? [],
    importsAvailable: input.importsAvailable ?? true,
    narrative,
    executive: {
      departmentStatus: narrative.departmentStatus,
      primaryAchievement: narrative.primaryAchievement,
      criticalRisk: narrative.criticalRisk,
      rawClaimCount,
      trackerProcessed: executiveNumber(supplier.executive, "tracker_processed"),
      fuelPumpReturns: supplier.fuelPumpReturns,
      totalAmountRequested: selectedMoney.total.value,
      partsAmountRequested: selectedMoney.warranty.value,
      laborAmountRequested: selectedMoney.labor.value,
      potentialLiability: givenLiability ?? (potentialLiabilityDerived && rawClaimCount != null && flatRate != null ? rawClaimCount * flatRate : null),
      potentialLiabilityDerived,
      flatRate,
      claimsDenied,
      claimsApproved: executiveNumber(supplier.executive, "claims_approved"),
      claimsPending: executiveNumber(supplier.executive, "claims_pending"),
      deniedLaborSavings: givenSavings ?? (deniedLaborSavingsDerived && claimsDenied != null && flatRate != null ? claimsDenied * flatRate : null),
      deniedLaborSavingsDerived,
      payoutPolicy: narrative.payoutPolicy,
    },
    tables: {
      months: months.map((key) => ({ key, label: monthLabel(key) })),
      metrics: {
        totalClaims: months.map((key) => metrics.get(key)?.totalClaims ?? null),
        totalProductAlerts: months.map((key) => metrics.get(key)?.totalProductAlerts ?? null),
      },
      financials: {
        total: moneyRows.map((row) => row.total.value),
        parts: moneyRows.map((row) => row.warranty.value),
        labor: moneyRows.map((row) => row.labor.value),
        totalSource: moneyRows.map((row) => row.total.source),
        partsSource: moneyRows.map((row) => row.warranty.source),
        laborSource: moneyRows.map((row) => row.labor.source),
        totalEditable: moneyRows.map((row) => row.total.editable),
        partsEditable: moneyRows.map((row) => row.warranty.editable),
        laborEditable: moneyRows.map((row) => row.labor.editable),
      },
      warranty: {
        ratio: months.map((_key, index) => ratioFor(index)),
        mttfDays: months.map((key) => warranty.get(key)?.mttfDays ?? null),
        medianDays: months.map((key) => warranty.get(key)?.medianDays ?? null),
      },
      topParts: [...supplier.topParts].sort((a, b) => b.totalClaims - a.totalClaims),
      fai: {
        source: supplierFai ? "supplier" : inAppFai && inAppFai.rows.length > 0 ? "accuqual" : "none",
        rows: faiRows,
        inAppOpen: inAppFai ? inAppFai.open : null,
      },
    },
    charts: {
      claimsSeriesScope: claimsReturns.length > 0 ? "month" : supplier.claimsSeries.length > 0 ? "file" : "empty",
      claimsReturns: claimsReturns.length > 0 ? claimsReturns : supplier.claimsSeries,
      fuelPumpReturns: supplier.fuelPumpReturns,
      topVehicles: [...supplier.topVehicles].sort((a, b) => b.claims - a.claims),
      emailIssues: months.map((key) => {
        const row = emailByMonth.get(key);
        return {
          month: key,
          label: monthLabel(key),
          totalIssues: row?.totalIssues ?? null,
          orIssues: row?.orIssues ?? null,
          napaIssues: row?.napaIssues ?? null,
        };
      }),
    },
    labor: {
      mttfDays: selectedWarranty?.mttfDays ?? null,
      medianDays: selectedWarranty?.medianDays ?? null,
    },
    claimMonth: {
      laborCount: laborBook?.count ?? null,
      laborHours: laborBook?.hours ?? null,
      laborCost: laborBook?.cost ?? null,
      warrantyCount: warrantyBook?.count ?? null,
      warrantyCost: warrantyBook?.cost ?? null,
    },
    productAlerts: {
      total: supplier.productAlerts?.total ?? selectedMetrics?.totalProductAlerts ?? null,
      open: supplier.productAlerts?.open ?? null,
      hoursSpent: supplier.productAlerts?.hoursSpent ?? null,
      avgDaysToClose: supplier.productAlerts?.avgDaysToClose ?? null,
      documentCount: live.productAlertDocuments,
    },
    sections: {
      quarantineNotes: narrative.quarantineNotes,
      recallsNotes: narrative.recallsNotes,
      emailIssuesNotes: narrative.emailIssuesNotes,
      fieldQuestions: narrative.fieldQuestions,
      palletNotes: narrative.palletNotes,
      rca: narrative.rca,
      recommendation: narrative.recommendation,
      productAlertNotes: narrative.productAlertNotes,
      techLine: narrative.techLine,
      fitment: narrative.fitment,
      productInfo: narrative.productInfo,
      pir: { status: "not_tracked", note: "AccuQual does not keep a PIR log. This line is left blank rather than shown as zero." },
    },
    live,
  };
}

export function isDepartmentStatus(value: unknown): value is DepartmentStatus {
  return value === "" || value === "green" || value === "yellow" || value === "red";
}

function asQa(value: unknown): QaItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const problem = typeof row.problem === "string" ? row.problem : "";
      const response = typeof row.response === "string" ? row.response : "";
      if (!problem && !response) return null;
      return { problem, response };
    })
    .filter((item): item is QaItem => item != null)
    .slice(0, 40);
}

export function normalizeNarrative(value: unknown): EngineeringNarrative {
  const blank = emptyNarrative();
  if (!value || typeof value !== "object") return blank;
  const row = value as Record<string, unknown>;
  const text = (key: keyof EngineeringNarrative) => (typeof row[key] === "string" ? (row[key] as string) : "");
  return {
    departmentStatus: isDepartmentStatus(row.departmentStatus) ? row.departmentStatus : "",
    primaryAchievement: text("primaryAchievement"),
    criticalRisk: text("criticalRisk"),
    payoutPolicy: text("payoutPolicy"),
    rca: text("rca"),
    recommendation: text("recommendation"),
    productAlertNotes: text("productAlertNotes"),
    quarantineNotes: text("quarantineNotes"),
    recallsNotes: text("recallsNotes"),
    emailIssuesNotes: text("emailIssuesNotes"),
    fieldQuestions: text("fieldQuestions"),
    palletNotes: text("palletNotes"),
    techLine: asQa(row.techLine),
    fitment: asQa(row.fitment),
    productInfo: asQa(row.productInfo),
    financialEntries: normalizeFinancialEntries(row.financialEntries),
    importPulls: normalizeImportPulls(row.importPulls),
  };
}

function normalizeImportPulls(value: unknown): ImportPull[] {
  if (!Array.isArray(value)) return [];
  const pulls: ImportPull[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const importId = Number(row.importId);
    const section = row.section;
    const field = typeof row.field === "string" ? row.field.trim() : "";
    if (!Number.isInteger(importId) || importId <= 0 || !field) continue;
    if (section !== "returns" && section !== "warranty" && section !== "labor" && section !== "financials") continue;
    pulls.push({ importId, section, field });
    if (pulls.length >= 24) break;
  }
  return pulls;
}
