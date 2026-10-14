/**
 * The Monthly Quality Report import target. monthlyQualityFields() is static (no
 * arguments), so the three trend tables (monthly_metrics/financials/warranty_metrics)
 * are modeled as ONE table field each, value = [header row, ...body rows] — the header
 * row carries the real month names from whichever file was uploaded, so the window
 * (which 6 months) is read from the file at propose time, not baked into the field list.
 */
import {
  emptySupplierData,
  type FaiCategoryRow,
  type FinancialMonth,
  type MonthMetric,
  type NamedCount,
  type NcrReportRow,
  type SupplierData,
  type SupplierNote,
  type TopPart,
} from "../../quality-engineering-report/model.js";
import { parseNumber } from "../../quality-engineering-report/supplierParse.js";
import type { ExtractedBlock, ExtractedFile } from "../extract.js";
import { proposeValues, type Proposal } from "../propose.js";
import type { TargetField } from "../targets.js";

const MONTH_NUM: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

/**
 * A trend-table header names months without a year. With the report month known, a month later in the
 * calendar than the report month belongs to the year before (a January report shows Aug..Jan).
 */
function monthKeyFor(monthName: string, year: number, reportMonth?: number): string | null {
  const num = MONTH_NUM[monthName.trim().toLowerCase()];
  if (!num) return null;
  const y = reportMonth != null && num > reportMonth ? year - 1 : year;
  return `${y}-${String(num).padStart(2, "0")}`;
}

/** parseNumber already strips "$" and ",". This also drops a trailing "Days"/"days". */
function numOrNull(raw: string | undefined): number | null {
  if (raw == null) return null;
  return parseNumber(raw.replace(/\s*days?\s*$/i, ""));
}

const EXEC_GROUP = "Executive Summary";
const ALERTS_GROUP = "Product Alerts";
const NOTES_GROUP = "Narrative";
const TABLES_GROUP = "Trend tables";

function tableField(key: string, label: string, columns?: { id: string; label: string }[]): TargetField {
  return { key, label, group: TABLES_GROUP, type: "table", columns };
}

function textField(key: string, label: string, group = NOTES_GROUP, type: "text" | "multiline" = "text"): TargetField {
  return { key, label, group, type };
}

export function monthlyQualityFields(): TargetField[] {
  return [
    tableField("monthly_metrics", "Metric"),
    tableField("financials", "Financial Category"),
    tableField("warranty_metrics", "Warranty Metric"),
    tableField("top_parts", "Top Returning Parts", [
      { id: "part", label: "Part Number" },
      { id: "desc", label: "Description / Application" },
      { id: "claims", label: "Total Claims" },
    ]),
    tableField("fai_categories", "First Article Verifications", [
      { id: "cat", label: "Product Category" },
      { id: "completed", label: "Total Completed" },
      { id: "passed", label: "Passed" },
      { id: "failed", label: "Failed" },
      { id: "dev", label: "Passed w/ Deviation" },
    ]),
    tableField("ncr_table", "NCR table (from report)", [
      { id: "ncrNumber", label: "NCR Number" },
      { id: "partNumber", label: "Part Number" },
      { id: "description", label: "Description of Defect" },
      { id: "disposition", label: "Disposition" },
      { id: "status", label: "Status" },
    ]),
    tableField("fuel_pump_returns", "Fuel Pump Returns (by source)", [
      { id: "source", label: "Source" },
      { id: "count", label: "Count" },
    ]),
    textField("executive.department_status", "Status of Department", EXEC_GROUP),
    textField("executive.raw_claim_count", "Total Claims — Raw Export", EXEC_GROUP),
    textField("executive.tracker_processed", "Total Claims — Tracker Processed", EXEC_GROUP),
    textField("executive.potential_liability", "Potential Liability", EXEC_GROUP),
    textField("executive.flat_rate", "Flat Rate", EXEC_GROUP),
    textField("executive.claims_denied", "Claims Denied", EXEC_GROUP),
    textField("executive.denied_labor_savings", "Denied Labor Savings", EXEC_GROUP),
    textField("executive.claims_approved", "Claims Approved", EXEC_GROUP),
    textField("executive.claims_pending", "Claims Pending", EXEC_GROUP),
    textField("product_alerts.total", "Total Product Alerts", ALERTS_GROUP),
    textField("product_alerts.open", "Open", ALERTS_GROUP),
    textField("product_alerts.hoursSpent", "Hours Spent Investigating", ALERTS_GROUP),
    textField("product_alerts.avgDaysToClose", "Avg time to close", ALERTS_GROUP),
    textField("notes.primary_achievement", "Primary Achievement", NOTES_GROUP, "multiline"),
    textField("notes.critical_risk", "Critical Risk / Blocker", NOTES_GROUP, "multiline"),
    textField("notes.payout_policy", "Actual Policy Payout (Labor)", NOTES_GROUP, "multiline"),
    textField("notes.rca", "Root Cause Analysis (RCA)", NOTES_GROUP, "multiline"),
    textField("notes.recommendation", "Recommendation", NOTES_GROUP, "multiline"),
    textField("notes.product_alert_notes", "Product Alert Notes", ALERTS_GROUP, "multiline"),
    textField("notes.quarantine", "Quarantine", NOTES_GROUP, "multiline"),
    textField("notes.recalls", "Recalls", NOTES_GROUP, "multiline"),
    textField("notes.field_question", "Field Question", NOTES_GROUP, "multiline"),
    textField("notes.pallet", "NAPA Black Label Pallet Work", NOTES_GROUP, "multiline"),
    textField("notes.ncr", "NCRs / CARs / PIRs / RPNs notes", NOTES_GROUP, "multiline"),
    textField("notes.email_issues", "OR/NAPA Email Issues notes", NOTES_GROUP, "multiline"),
    { key: "notes.fitment", label: "Fitment Verification", group: NOTES_GROUP, type: "table", columns: [{ id: "problem", label: "Problem" }, { id: "response", label: "Response" }] },
    { key: "notes.product_info", label: "Product Information", group: NOTES_GROUP, type: "table", columns: [{ id: "problem", label: "Problem" }, { id: "response", label: "Response" }] },
    { key: "notes.tech_line", label: "NAPA Tech Line / Collabtic", group: NOTES_GROUP, type: "table", columns: [{ id: "problem", label: "Problem" }, { id: "response", label: "Response" }] },
  ];
}

// ---- extraction helpers (operate directly on Phase 1's ExtractedFile) ----

function paras(file: ExtractedFile): Extract<ExtractedBlock, { kind: "para" }>[] {
  return file.blocks.filter((block): block is Extract<ExtractedBlock, { kind: "para" }> => block.kind === "para");
}

function headings(file: ExtractedFile): Extract<ExtractedBlock, { kind: "heading" }>[] {
  return file.blocks.filter((block): block is Extract<ExtractedBlock, { kind: "heading" }> => block.kind === "heading");
}

function tables(file: ExtractedFile): Extract<ExtractedBlock, { kind: "table" }>[] {
  return file.blocks.filter((block): block is Extract<ExtractedBlock, { kind: "table" }> => block.kind === "table");
}

function stripLeadingNumber(text: string): string {
  return text.replace(/^\s*\d+(?:\.\d+)*\s*[-–—:.]?\s*/, "").trim();
}

/** The nearest heading (after its leading number) containing every keyword, case-insensitive. */
function sectionContaining(file: ExtractedFile, ...keywords: string[]): string | null {
  for (const heading of headings(file)) {
    const stripped = stripLeadingNumber(heading.text).toLowerCase();
    if (keywords.every((word) => stripped.includes(word.toLowerCase()))) return heading.text;
  }
  return null;
}

function parasUnder(file: ExtractedFile, sectionHeadingText: string): Extract<ExtractedBlock, { kind: "para" }>[] {
  return paras(file).filter((block) => block.section === sectionHeadingText);
}

/** All paras under the first heading containing every keyword, joined with a blank line. */
function joinedSection(file: ExtractedFile, ...keywords: string[]): { value: string | null; source: string | null } {
  const section = sectionContaining(file, ...keywords);
  if (!section) return { value: null, source: null };
  const body = parasUnder(file, section)
    .map((block) => block.text)
    .filter(Boolean);
  if (body.length === 0) return { value: null, source: section };
  return { value: body.join("\n\n"), source: section };
}

/** Finds the first "label: value" line anywhere (or within a given section), label matched exactly. */
function labelLine(file: ExtractedFile, label: string, withinSection?: string): { value: string | null; source: string | null } {
  const pattern = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*(.+)$`, "i");
  for (const block of paras(file)) {
    if (withinSection && block.section !== withinSection) continue;
    for (const line of block.text.split("\n")) {
      const match = pattern.exec(line.trim());
      if (match) return { value: match[1]!.trim(), source: `${block.section ?? ""} > '${label}:'` };
    }
  }
  return { value: null, source: null };
}

/** All paras under the first heading containing every keyword in ANY of the keyword sets, joined like joinedSection. */
function joinedSectionAny(file: ExtractedFile, keywordSets: string[][]): { value: string | null; source: string | null } {
  for (const keywords of keywordSets) {
    const found = joinedSection(file, ...keywords);
    if (found.source) return found;
  }
  return { value: null, source: null };
}

function tableByFirstHeader(file: ExtractedFile, headerLabel: string): string[][] | null {
  for (const table of tables(file)) {
    if ((table.rows[0]?.[0] ?? "").trim() === headerLabel) return table.rows;
  }
  return null;
}

/** "Breakdown of Fuel Pumps returned ...:\n• Source: Count\n• Source: Count" under 6.1. */
function fuelPumpReturnsTable(file: ExtractedFile): { rows: string[][]; source: string | null } {
  const section = sectionContaining(file, "executive summary") ?? headings(file)[0]?.text ?? null;
  for (const block of paras(file)) {
    if (!/breakdown of fuel pumps returned/i.test(block.text)) continue;
    const rows: string[][] = [];
    for (const rawLine of block.text.split("\n")) {
      const line = rawLine.replace(/^[•\s]+/, "").trim();
      const match = /^(.+?):\s*(\d[\d,]*)\s*$/.exec(line);
      if (match) rows.push([match[1]!.trim(), match[2]!.replace(/,/g, "")]);
    }
    return { rows, source: block.section ?? section };
  }
  return { rows: [], source: null };
}

/** Problem:/Response: pairs under a section. A plain lead-in para before the first "Problem:" prefixes that problem. */
function problemResponsePairs(file: ExtractedFile, sectionHeadingText: string | null): string[][] {
  if (!sectionHeadingText) return [];
  const rows: string[][] = [];
  let leadIn = "";
  let pendingProblem: string | null = null;
  for (const block of parasUnder(file, sectionHeadingText)) {
    const text = block.text;
    const splitAt = text.search(/response:/i);
    if (splitAt >= 0) {
      // Either one para holds both ("Problem: ...\nResponse: ...") or this is the Response half of a separate Problem: para.
      const leadingPart = text.slice(0, splitAt).replace(/^problem:\s*/i, "").trim();
      const responsePart = text.slice(splitAt).replace(/^response:\s*/i, "").trim();
      const problemPart = leadingPart || pendingProblem || "";
      pendingProblem = null;
      rows.push([problemPart, responsePart]);
      continue;
    }
    const problemMatch = /^problem:\s*([\s\S]*)$/i.exec(text);
    if (problemMatch) {
      if (pendingProblem != null) rows.push([pendingProblem, ""]);
      pendingProblem = leadIn ? `${leadIn} ${problemMatch[1]!.trim()}` : problemMatch[1]!.trim();
      leadIn = "";
      continue;
    }
    if (pendingProblem == null) leadIn = leadIn ? `${leadIn} ${text}` : text;
  }
  if (pendingProblem != null) rows.push([pendingProblem, ""]);
  return rows;
}

export interface MonthlyQualityProposals {
  proposals: Proposal[];
  warnings: string[];
}

export function proposeMonthlyQuality(extracted: ExtractedFile): MonthlyQualityProposals {
  const fields = monthlyQualityFields();
  const warnings: string[] = [];
  const byKey = new Map<string, Proposal>();

  const ruleFor = (reason: string): Proposal["rule"] => {
    if (reason.includes("Heading")) return "heading";
    if (reason.includes("Problem/Response") || reason.includes("trend table") || reason.includes("bullet lines")) return "tableField";
    return "label";
  };
  const put = (key: string, label: string, value: Proposal["value"], source: string | null, reason: string) => {
    byKey.set(key, { key, label, value: value ?? null, source, score: value == null ? 0 : 1, reason: value == null ? "no match" : reason, rule: value == null ? null : ruleFor(reason) });
  };

  for (const key of ["monthly_metrics", "financials", "warranty_metrics"] as const) {
    const field = fields.find((f) => f.key === key)!;
    const rows = tableByFirstHeader(extracted, field.label);
    put(key, field.label, rows, rows ? "trend table" : null, "trend table");
  }

  const genericTableFields = fields.filter((field) => field.key === "top_parts" || field.key === "fai_categories");
  for (const proposal of proposeValues(extracted, genericTableFields)) byKey.set(proposal.key, proposal);

  const ncrRows = tableByFirstHeader(extracted, "NCR Number");
  put("ncr_table", "NCR table (from report)", ncrRows, ncrRows ? sectionContaining(extracted, "ncr") ?? "NCR table" : null, "trend table");

  const fuel = fuelPumpReturnsTable(extracted);
  put("fuel_pump_returns", "Fuel Pump Returns (by source)", fuel.rows.length ? fuel.rows : null, fuel.source, "bullet lines under Executive Summary");

  const status = labelLine(extracted, "Status of Department");
  put("executive.department_status", "Status of Department", status.value ? status.value.toLowerCase() : null, status.source, "Label match");

  const totalClaimsLine = labelLine(extracted, "Total Claims");
  const totalClaimsMatch = totalClaimsLine.value ? /^(\d[\d,]*)\s*\(raw export\)\s*\/\s*(\d[\d,]*)\s*\(tracker processed\)/i.exec(totalClaimsLine.value) : null;
  put("executive.raw_claim_count", "Total Claims — Raw Export", totalClaimsMatch ? totalClaimsMatch[1]!.replace(/,/g, "") : null, totalClaimsLine.source, "Total Claims line");
  put("executive.tracker_processed", "Total Claims — Tracker Processed", totalClaimsMatch ? totalClaimsMatch[2]!.replace(/,/g, "") : null, totalClaimsLine.source, "Total Claims line");

  const liabilityLine = labelLine(extracted, "Potential Liability");
  const liabilityMatch = liabilityLine.value ? /^\$?([\d,.]+)\s*\(.*?@\s*\$?([\d,.]+)\s*flat rate/i.exec(liabilityLine.value) : null;
  put("executive.potential_liability", "Potential Liability", liabilityMatch ? String(numOrNull(liabilityMatch[1]) ?? "") || null : null, liabilityLine.source, "Potential Liability line");
  put("executive.flat_rate", "Flat Rate", liabilityMatch ? String(numOrNull(liabilityMatch[2]) ?? "") || null : null, liabilityLine.source, "Potential Liability line");

  const deniedLine = labelLine(extracted, "Claims Denied");
  const deniedMatch = deniedLine.value ? /^(\d[\d,]*)\s*-\s*currently saving approximately\s*\$?([\d,.]+)/i.exec(deniedLine.value) : null;
  put("executive.claims_denied", "Claims Denied", deniedMatch ? deniedMatch[1]!.replace(/,/g, "") : null, deniedLine.source, "Claims Denied line");
  put("executive.denied_labor_savings", "Denied Labor Savings", deniedMatch ? String(numOrNull(deniedMatch[2]) ?? "") || null : null, deniedLine.source, "Claims Denied line");

  const approvedLine = labelLine(extracted, "Approved");
  const approvedMatch = approvedLine.value ? /^(\d[\d,]*)\s*claims/i.exec(approvedLine.value) : null;
  put("executive.claims_approved", "Claims Approved", approvedMatch ? approvedMatch[1]!.replace(/,/g, "") : null, approvedLine.source, "Approved line");

  const pendingLine = labelLine(extracted, "Pending/Unentered");
  const pendingMatch = pendingLine.value ? /^(\d[\d,]*)\s*claims/i.exec(pendingLine.value) : null;
  put("executive.claims_pending", "Claims Pending", pendingMatch ? pendingMatch[1]!.replace(/,/g, "") : null, pendingLine.source, "Pending/Unentered line");

  const alertsSection = sectionContaining(extracted, "product alerts");
  const alertLine = (label: string) => (alertsSection ? labelLine(extracted, label, alertsSection) : { value: null, source: null });
  const totalAlerts = alertLine("Total Product Alerts");
  put("product_alerts.total", "Total Product Alerts", totalAlerts.value, totalAlerts.source, "Label match");
  const openAlerts = alertLine("Open");
  put("product_alerts.open", "Open", openAlerts.value, openAlerts.source, "Label match");
  const hoursAlerts = alertLine("Hours Spent Investigating");
  put("product_alerts.hoursSpent", "Hours Spent Investigating", hoursAlerts.value, hoursAlerts.source, "Label match");
  const avgAlerts = alertLine("Avg time to close");
  put("product_alerts.avgDaysToClose", "Avg time to close", avgAlerts.value, avgAlerts.source, "Label match");
  const notesAlerts = alertLine("Notes");
  put("notes.product_alert_notes", "Product Alert Notes", notesAlerts.value, notesAlerts.source, "Label match");

  const achievement = labelLine(extracted, "Primary Achievement");
  put("notes.primary_achievement", "Primary Achievement", achievement.value, achievement.source, "Label match");

  const payout = labelLine(extracted, "Actual Policy Payout (Labor)");
  put("notes.payout_policy", "Actual Policy Payout (Labor)", payout.value, payout.source, "Label match");

  // Critical Risk/Blocker: a dangling label para, then paras up to (not including) "Total Claims:".
  {
    const list = paras(extracted);
    const startIndex = list.findIndex((block) => /^critical risk\s*\/?\s*blocker:?\s*$/i.test(block.text.trim()));
    let value: string | null = null;
    let source: string | null = null;
    if (startIndex >= 0) {
      const collected: string[] = [];
      for (let i = startIndex + 1; i < list.length; i += 1) {
        if (/^total claims:/i.test(list[i]!.text.trim())) break;
        collected.push(list[i]!.text);
      }
      if (collected.length > 0) {
        value = collected.join("\n\n");
        source = list[startIndex]!.section;
      }
    }
    put("notes.critical_risk", "Critical Risk / Blocker", value, source, "Critical Risk/Blocker section");
  }

  const rca = joinedSection(extracted, "root cause");
  put("notes.rca", "Root Cause Analysis (RCA)", rca.value, rca.source, "Heading match");
  const recommendation = joinedSection(extracted, "recommendation");
  put("notes.recommendation", "Recommendation", recommendation.value, recommendation.source, "Heading match");
  const quarantine = joinedSection(extracted, "quarantine");
  put("notes.quarantine", "Quarantine", quarantine.value, quarantine.source, "Heading match");
  const recalls = joinedSection(extracted, "recall");
  put("notes.recalls", "Recalls", recalls.value, recalls.source, "Heading match");
  const fieldQuestion = joinedSection(extracted, "field", "question");
  put("notes.field_question", "Field Question", fieldQuestion.value, fieldQuestion.source, "Heading match");
  const pallet = joinedSection(extracted, "pallet");
  put("notes.pallet", "NAPA Black Label Pallet Work", pallet.value, pallet.source, "Heading match");

  const ncrNotes = joinedSectionAny(extracted, [["cars"], ["rpn"], ["ncr"]]);
  put("notes.ncr", "NCRs / CARs / PIRs / RPNs notes", ncrNotes.value, ncrNotes.source, "Heading match");
  const emailNotes = joinedSection(extracted, "email issues");
  put("notes.email_issues", "OR/NAPA Email Issues notes", emailNotes.value, emailNotes.source, "Heading match");

  const fitmentSection = sectionContaining(extracted, "fitment");
  const fitmentRows = problemResponsePairs(extracted, fitmentSection);
  put("notes.fitment", "Fitment Verification", fitmentRows.length ? fitmentRows : null, fitmentSection, "Problem/Response pairs");

  const productInfoSection = sectionContaining(extracted, "product information");
  const productInfoRows = problemResponsePairs(extracted, productInfoSection);
  put("notes.product_info", "Product Information", productInfoRows.length ? productInfoRows : null, productInfoSection, "Problem/Response pairs");

  const techLineSection = sectionContaining(extracted, "tech line") ?? sectionContaining(extracted, "collabtic");
  const techLineRows = problemResponsePairs(extracted, techLineSection);
  put("notes.tech_line", "NAPA Tech Line / Collabtic", techLineRows.length ? techLineRows : null, techLineSection, "Problem/Response pairs");

  // Only content that was really skipped is reported: a picture over a limit or in an unsupported format.
  warnings.push(...(extracted.imageWarnings ?? []));

  const proposals = fields.map((field) => byKey.get(field.key) ?? { key: field.key, label: field.label, value: null, source: null, score: 0, reason: "no match", rule: null });
  return { proposals, warnings };
}

// ---- values -> SupplierData (no invented values; parseNumber for every number) ----

function asTable(value: unknown): string[][] | null {
  return Array.isArray(value) ? (value as string[][]) : null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function fillMonthRows(
  rows: string[][],
  year: number,
  byMonth: Map<string, Record<string, unknown>>,
  rowMap: Record<string, string>,
  numeric: Set<string>,
  reportMonth?: number,
): void {
  const header = rows[0] ?? [];
  for (const row of rows.slice(1)) {
    const field = rowMap[(row[0] ?? "").trim().toLowerCase()];
    if (!field) continue;
    header.slice(1).forEach((monthName, index) => {
      const key = monthKeyFor(monthName, year, reportMonth);
      if (!key) return;
      const entry = byMonth.get(key) ?? {};
      const raw = row[index + 1] ?? "";
      entry[field] = numeric.has(field) ? numOrNull(raw) : raw.trim() || null;
      byMonth.set(key, entry);
    });
  }
}

/** Header cells matched loosely by name, never by position. Cell text is kept exactly as written ("[Unassigned]" stays). */
export function ncrRowsFromTable(rows: string[][]): NcrReportRow[] {
  const header = (rows[0] ?? []).map((cell) => cell.trim().toLowerCase());
  const find = (...patterns: RegExp[]) => header.findIndex((cell) => patterns.some((pattern) => pattern.test(cell)));
  const at = {
    ncrNumber: find(/ncr/, /number/),
    partNumber: find(/part/),
    description: find(/descr/, /defect/),
    disposition: find(/dispos/),
    status: find(/status/),
  };
  const cell = (row: string[], index: number) => (index >= 0 ? (row[index] ?? "").trim() : "");
  return rows
    .slice(1)
    .map((row): NcrReportRow => ({
      ncrNumber: cell(row, at.ncrNumber),
      partNumber: cell(row, at.partNumber),
      description: cell(row, at.description),
      disposition: cell(row, at.disposition),
      status: cell(row, at.status),
    }))
    .filter((row) => Object.values(row).some((value) => value !== ""));
}

export function toSupplierData(values: Record<string, string | string[][] | null | undefined>, year: number, reportMonth?: number): SupplierData {
  const data = emptySupplierData();

  const monthlyRows = asTable(values["monthly_metrics"]);
  if (monthlyRows) {
    const byMonth = new Map<string, Record<string, unknown>>();
    fillMonthRows(monthlyRows, year, byMonth, { "total claims": "totalClaims", "total product alerts": "totalProductAlerts" }, new Set(["totalClaims", "totalProductAlerts"]), reportMonth);
    const metrics: MonthMetric[] = [];
    for (const [month, entry] of byMonth) {
      metrics.push({ month, totalClaims: (entry.totalClaims as number | null) ?? null, totalProductAlerts: (entry.totalProductAlerts as number | null) ?? null });
    }
    data.monthlyMetrics = metrics;
  }

  const financialRows = asTable(values["financials"]);
  if (financialRows) {
    const byMonth = new Map<string, Record<string, unknown>>();
    fillMonthRows(
      financialRows,
      year,
      byMonth,
      { "total amount requested": "totalAmount", "parts amount requested": "partsAmount", "labor amount requested": "laborAmount" },
      new Set(["totalAmount", "partsAmount", "laborAmount"]),
      reportMonth,
    );
    const financials: FinancialMonth[] = [];
    for (const [month, entry] of byMonth) {
      financials.push({
        month,
        totalAmount: (entry.totalAmount as number | null) ?? null,
        partsAmount: (entry.partsAmount as number | null) ?? null,
        laborAmount: (entry.laborAmount as number | null) ?? null,
      });
    }
    data.financials = financials;
  }

  const warrantyRows = asTable(values["warranty_metrics"]);
  if (warrantyRows) {
    const header = warrantyRows[0] ?? [];
    const byMonth = new Map<string, { laborToPartsRatio: string | null; mttfDays: number | null; medianDays: number | null }>();
    for (const row of warrantyRows.slice(1)) {
      const label = (row[0] ?? "").trim().toLowerCase();
      header.slice(1).forEach((monthName, index) => {
        const key = monthKeyFor(monthName, year, reportMonth);
        if (!key) return;
        const entry = byMonth.get(key) ?? { laborToPartsRatio: null, mttfDays: null, medianDays: null };
        const raw = (row[index + 1] ?? "").trim();
        if (label === "labor-to-parts ratio") entry.laborToPartsRatio = raw || null;
        else if (label === "mean time to failure") entry.mttfDays = numOrNull(raw);
        else if (label === "median time to failure") entry.medianDays = numOrNull(raw);
        byMonth.set(key, entry);
      });
    }
    data.warrantyMetrics = [...byMonth.entries()].map(([month, entry]) => ({ month, ...entry }));
  }

  const topPartsRows = asTable(values["top_parts"]);
  if (topPartsRows) {
    data.topParts = topPartsRows.map((row): TopPart => ({ partNumber: (row[0] ?? "").trim(), description: (row[1] ?? "").trim(), totalClaims: numOrNull(row[2]) ?? 0 }));
  }

  const faiRows = asTable(values["fai_categories"]);
  if (faiRows) {
    data.faiCategories = faiRows
      .filter((row) => (row[0] ?? "").trim().toLowerCase() !== "total")
      .map((row): FaiCategoryRow => ({
        category: (row[0] ?? "").trim(),
        totalCompleted: numOrNull(row[1]) ?? 0,
        passed: numOrNull(row[2]) ?? 0,
        failed: numOrNull(row[3]) ?? 0,
        passedWithDeviation: numOrNull(row[4]) ?? 0,
      }));
  }

  const fuelRows = asTable(values["fuel_pump_returns"]);
  if (fuelRows) {
    data.fuelPumpReturns = fuelRows.map((row): NamedCount => ({ source: (row[0] ?? "").trim(), count: numOrNull(row[1]) ?? 0 }));
  }

  const exec = (key: string) => asText(values[`executive.${key}`]);
  if (exec("department_status")) data.executive.department_status = exec("department_status");
  if (exec("raw_claim_count")) data.executive.raw_claim_count = exec("raw_claim_count");
  if (exec("tracker_processed")) data.executive.tracker_processed = exec("tracker_processed");
  if (exec("potential_liability")) data.executive.potential_liability = exec("potential_liability");
  if (exec("flat_rate")) data.executive.flat_rate = exec("flat_rate");
  if (exec("claims_denied")) data.executive.claims_denied = exec("claims_denied");
  if (exec("denied_labor_savings")) data.executive.denied_labor_savings = exec("denied_labor_savings");
  if (exec("claims_approved")) data.executive.claims_approved = exec("claims_approved");
  if (exec("claims_pending")) data.executive.claims_pending = exec("claims_pending");

  const alert = (key: string) => asText(values[`product_alerts.${key}`]);
  const alertsPresent = ["total", "open", "hoursSpent", "avgDaysToClose"].some((key) => alert(key));
  if (alertsPresent) {
    data.productAlerts = {
      total: numOrNull(alert("total")),
      open: numOrNull(alert("open")),
      hoursSpent: numOrNull(alert("hoursSpent")),
      avgDaysToClose: numOrNull(alert("avgDaysToClose")),
    };
  }

  const pushNote = (section: string, key: string) => {
    const text = asText(values[key]);
    if (text) data.notes.push({ section, problem: text, response: "" });
  };
  pushNote("primary_achievement", "notes.primary_achievement");
  pushNote("critical_risk", "notes.critical_risk");
  pushNote("payout_policy", "notes.payout_policy");
  pushNote("rca", "notes.rca");
  pushNote("recommendation", "notes.recommendation");
  pushNote("product_alert_notes", "notes.product_alert_notes");
  pushNote("quarantine", "notes.quarantine");
  pushNote("recalls", "notes.recalls");
  pushNote("field_question", "notes.field_question");
  pushNote("pallet", "notes.pallet");

  const pushPairs = (section: string, key: string) => {
    const rows = asTable(values[key]);
    if (!rows) return;
    for (const row of rows) {
      const problem = (row[0] ?? "").trim();
      const response = (row[1] ?? "").trim();
      if (problem || response) data.notes.push({ section, problem, response } satisfies SupplierNote);
    }
  };
  pushNote("ncr", "notes.ncr");
  pushNote("email_issues", "notes.email_issues");

  const ncrRows = asTable(values["ncr_table"]);
  if (ncrRows) data.ncrTable = ncrRowsFromTable(ncrRows);

  pushPairs("fitment", "notes.fitment");
  pushPairs("product_info", "notes.product_info");
  pushPairs("tech_line", "notes.tech_line");

  return data;
}
