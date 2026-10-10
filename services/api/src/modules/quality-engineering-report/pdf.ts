import type { FormLayout } from "../forms/layouts/types.js";
import { renderFormLayoutAsPdf } from "../forms/schema-pdf-renderer.js";
import type { ControlledPdfFrame } from "../forms/controlledPdf.js";
import { money, type EngineeringReportView, type Gated, type QaItem } from "./model.js";

function dash(value: number | string | null | undefined): string {
  if (value == null || value === "") return "—";
  return String(value);
}

function moneyCell(value: number | null): string {
  return value == null ? "—" : money(value);
}

function gatedCount(gate: Gated<{ count: number }>): string {
  if (gate.status === "no_access") return "No access";
  if (gate.status === "unavailable") return gate.reason;
  return String(gate.data.count);
}

function importedDatasetNote(view: EngineeringReportView): string {
  const base = "Dollars are AccuQual Labor Claims and Warranty claims. A month with no records uses the amount entered on this report.";
  const lines = (view.importedDatasets ?? []).map((line) => {
    const amount = line.total == null ? "—" : String(line.total);
    return `${line.fieldLabel} (${line.section}): ${amount} from ${line.source}`;
  });
  if (lines.length === 0) return base;
  return `${base} Imported datasets: ${lines.join("; ")}.`;
}

function qaLines(items: QaItem[]): string {
  if (items.length === 0) return "";
  return items.map((item, index) => `${index + 1}. ${item.problem}${item.response ? `\nResponse: ${item.response}` : ""}`).join("\n\n");
}

/** PDF of one monthly quality report. Chart series are tables of the same numbers drawn on screen. */
export async function renderEngineeringReportPdf(view: EngineeringReportView, frame: ControlledPdfFrame | null): Promise<Uint8Array> {
  const months = view.tables.months;
  const data: Record<string, unknown> = {
    document: `${view.documentId} | Rev ${view.revision} | ${view.documentTitle}`,
    status: view.executive.departmentStatus ? view.executive.departmentStatus.toUpperCase() : "—",
    achievement: view.executive.primaryAchievement || "—",
    risk: view.executive.criticalRisk || "—",
    claims: view.executive.rawClaimCount == null ? "—" : `${view.executive.rawClaimCount} raw${view.executive.trackerProcessed == null ? "" : ` / ${view.executive.trackerProcessed} in the tracker`}`,
    pumps: view.executive.fuelPumpReturns.length === 0 ? "—" : view.executive.fuelPumpReturns.map((row) => `${row.source}: ${row.count}`).join("; "),
    requested: moneyCell(view.executive.totalAmountRequested),
    partsAmount: moneyCell(view.executive.partsAmountRequested),
    labor: moneyCell(view.executive.laborAmountRequested),
    financialNote: importedDatasetNote(view),
    laborCount: view.claimMonth.laborCount == null ? "—" : String(view.claimMonth.laborCount),
    laborHours: view.claimMonth.laborHours == null ? "—" : String(view.claimMonth.laborHours),
    laborCost: moneyCell(view.claimMonth.laborCost),
    warrantyCount: view.claimMonth.warrantyCount == null ? "—" : String(view.claimMonth.warrantyCount),
    warrantyCost: moneyCell(view.claimMonth.warrantyCost),
    liability: moneyCell(view.executive.potentialLiability),
    flat: view.executive.flatRate == null ? "—" : money(view.executive.flatRate),
    approved: dash(view.executive.claimsApproved),
    denied: dash(view.executive.claimsDenied),
    pending: dash(view.executive.claimsPending),
    savings: moneyCell(view.executive.deniedLaborSavings),
    payout: view.executive.payoutPolicy || "—",
    mttf: view.labor.mttfDays == null ? "—" : `${view.labor.mttfDays} days`,
    median: view.labor.medianDays == null ? "—" : `${view.labor.medianDays} days`,
    rca: view.sections.rca || "—",
    recommendation: view.sections.recommendation || "—",
    alertTotal: dash(view.productAlerts.total),
    alertOpen: dash(view.productAlerts.open),
    alertHours: dash(view.productAlerts.hoursSpent),
    alertAvg: dash(view.productAlerts.avgDaysToClose),
    alertNotes: view.sections.productAlertNotes || "—",
    alertDocs: gatedCount(view.productAlerts.documentCount),
    quarantineNotes: view.sections.quarantineNotes || (view.live.quarantine.status === "ok" && view.live.quarantine.data.rows.length === 0 ? "No new parts quarantined." : "—"),
    recallNotes: view.sections.recallsNotes || (view.live.recallDocuments.status === "ok" && view.live.recallDocuments.data.count === 0 ? "No new recalls" : "—"),
    recallDocs: gatedCount(view.live.recallDocuments),
    tech: qaLines(view.sections.techLine) || "—",
    emailNotes: view.sections.emailIssuesNotes || "—",
    field: view.sections.fieldQuestions || "—",
    fitment: qaLines(view.sections.fitment) || "—",
    productInfo: qaLines(view.sections.productInfo) || "—",
    pallet: view.sections.palletNotes || "—",
    pir: view.sections.pir.note,
    ncrSummary:
      view.live.ncr.status === "ok"
        ? `${view.live.ncr.data.total} logged (${view.live.ncr.data.open} open, ${view.live.ncr.data.closed} closed).`
        : view.live.ncr.status === "no_access"
          ? "No access to NCR."
          : view.live.ncr.reason,
    carSummary:
      view.live.cars.status === "ok"
        ? `CARs (supplier corrective actions): ${view.live.cars.data.scar == null ? "no access" : view.live.cars.data.scar}. CAPA records: ${view.live.cars.data.capa == null ? "no access" : view.live.cars.data.capa}.`
        : view.live.cars.status === "no_access"
          ? "No access to CAPA or supplier corrective actions."
          : view.live.cars.reason,
    rpnSummary: view.live.rpn.status === "ok" ? String(view.live.rpn.data.count) : view.live.rpn.status === "no_access" ? "No access" : view.live.rpn.reason,
    faiSource: view.tables.fai.source === "supplier" ? "Supplier upload" : view.tables.fai.source === "accuqual" ? "AccuQual first articles" : "No first-article totals for this month.",
  };

  const metricRows = [
    { metric: "Total Claims", ...Object.fromEntries(months.map((month, index) => [month.key, dash(view.tables.metrics.totalClaims[index] ?? null)])) },
    { metric: "Total Product Alerts", ...Object.fromEntries(months.map((month, index) => [month.key, dash(view.tables.metrics.totalProductAlerts[index] ?? null)])) },
  ];
  const financialRows = [
    { metric: "Total (Labor Claims + Warranty)", ...Object.fromEntries(months.map((month, index) => [month.key, moneyCell(view.tables.financials.total[index] ?? null)])) },
    { metric: "Warranty (Warranty claims)", ...Object.fromEntries(months.map((month, index) => [month.key, moneyCell(view.tables.financials.parts[index] ?? null)])) },
    { metric: "Labor (Labor Claims)", ...Object.fromEntries(months.map((month, index) => [month.key, moneyCell(view.tables.financials.labor[index] ?? null)])) },
  ];
  const warrantyRows = [
    { metric: "Labor-to-Warranty", ...Object.fromEntries(months.map((month, index) => [month.key, dash(view.tables.warranty.ratio[index] ?? null)])) },
    { metric: "Mean Time to Failure", ...Object.fromEntries(months.map((month, index) => [month.key, view.tables.warranty.mttfDays[index] == null ? "—" : `${view.tables.warranty.mttfDays[index]} days`])) },
    { metric: "Median Time to Failure", ...Object.fromEntries(months.map((month, index) => [month.key, view.tables.warranty.medianDays[index] == null ? "—" : `${view.tables.warranty.medianDays[index]} days`])) },
  ];
  data.metrics = metricRows;
  data.financials = financialRows;
  data.warranty = warrantyRows;
  data.topParts = view.tables.topParts.map((row) => ({ part: row.partNumber, description: row.description, claims: String(row.totalClaims) }));
  data.claimsChart = view.charts.claimsReturns.map((row) => ({ date: row.date, claims: String(row.claims), returns: String(row.returns) }));
  data.vehicles = view.charts.topVehicles.map((row) => ({ vehicle: row.vehicle, claims: String(row.claims) }));
  data.emailChart = view.charts.emailIssues.map((row) => ({
    month: row.label,
    total: dash(row.totalIssues),
    oreilly: dash(row.orIssues),
    napa: dash(row.napaIssues),
  }));
  data.fai = view.tables.fai.rows.map((row) => ({
    category: row.category,
    completed: String(row.totalCompleted),
    passed: String(row.passed),
    failed: String(row.failed),
    deviation: String(row.passedWithDeviation),
  }));
  data.ncrs =
    view.live.ncr.status === "ok"
      ? view.live.ncr.data.rows.map((row) => ({
          number: row.number,
          part: row.partNumber,
          defect: row.description,
          disposition: row.disposition || "—",
          status: row.status,
        }))
      : [];
  data.holds =
    view.live.quarantine.status === "ok"
      ? view.live.quarantine.data.rows.map((row) => ({ item: row.label, quantity: row.quantity, reason: row.reason, status: row.status }))
      : [];

  const monthColumns = months.map((month) => ({ key: month.key, label: month.label, kind: "text" as const }));
  const layout: FormLayout = {
    formType: "quality_engineering_report",
    title: view.title,
    sections: [
      {
        number: "6.1",
        title: "Executive Summary",
        blocks: [
          { type: "row", fields: [{ kind: "text", name: "document", label: "Document" }, { kind: "text", name: "status", label: "Status" }] },
          { type: "textarea", name: "achievement", label: "Primary achievement" },
          { type: "textarea", name: "risk", label: "Critical risk / blocker" },
          { type: "row", fields: [{ kind: "text", name: "claims", label: "Total claims" }, { kind: "text", name: "pumps", label: "Fuel pump returns" }] },
          { type: "row", fields: [{ kind: "text", name: "requested", label: "Total (Labor Claims + Warranty)" }, { kind: "text", name: "partsAmount", label: "Warranty" }, { kind: "text", name: "labor", label: "Labor" }] },
          { type: "row", fields: [{ kind: "text", name: "liability", label: "Potential liability" }, { kind: "text", name: "flat", label: "Flat rate" }, { kind: "text", name: "savings", label: "Denied labor savings" }] },
          { type: "row", fields: [{ kind: "text", name: "approved", label: "Approved" }, { kind: "text", name: "denied", label: "Denied" }, { kind: "text", name: "pending", label: "Pending" }] },
          { type: "textarea", name: "payout", label: "Payout policy" },
        ],
      },
      {
        number: "6.1b",
        title: "Trend tables",
        blocks: [
          { type: "table", name: "metrics", columns: [{ key: "metric", label: "Metric", kind: "text" }, ...monthColumns] },
          { type: "textarea", name: "financialNote", label: "Dollar source" },
          { type: "table", name: "financials", columns: [{ key: "metric", label: "Financial category", kind: "text" }, ...monthColumns] },
          { type: "table", name: "warranty", columns: [{ key: "metric", label: "Warranty metric", kind: "text" }, ...monthColumns] },
        ],
      },
      {
        number: "6.2",
        title: "Labor Claims",
        blocks: [
          { type: "row", fields: [{ kind: "text", name: "laborCount", label: "Labor claims" }, { kind: "text", name: "laborHours", label: "Labor hours" }, { kind: "text", name: "laborCost", label: "Labor cost" }] },
          { type: "row", fields: [{ kind: "text", name: "warrantyCount", label: "Warranty claims" }, { kind: "text", name: "warrantyCost", label: "Warranty cost" }] },
          { type: "row", fields: [{ kind: "text", name: "mttf", label: "Mean time to failure" }, { kind: "text", name: "median", label: "Median time to failure" }] },
          { type: "table", name: "claimsChart", columns: [{ key: "date", label: "Date", kind: "text" }, { key: "claims", label: "Claims", kind: "text" }, { key: "returns", label: "Returns", kind: "text" }] },
          { type: "table", name: "topParts", columns: [{ key: "part", label: "Part number", kind: "text" }, { key: "description", label: "Description", kind: "text" }, { key: "claims", label: "Total claims", kind: "text" }] },
          { type: "table", name: "vehicles", columns: [{ key: "vehicle", label: "Vehicle", kind: "text" }, { key: "claims", label: "Claims", kind: "text" }] },
          { type: "textarea", name: "rca", label: "Root cause analysis" },
          { type: "textarea", name: "recommendation", label: "Recommendation" },
        ],
      },
      {
        number: "6.3",
        title: "Product Alerts",
        blocks: [
          { type: "row", fields: [{ kind: "text", name: "alertTotal", label: "Total" }, { kind: "text", name: "alertOpen", label: "Open" }, { kind: "text", name: "alertHours", label: "Hours" }, { kind: "text", name: "alertAvg", label: "Avg days to close" }] },
          { type: "row", fields: [{ kind: "text", name: "alertDocs", label: "Product alert documents filed" }] },
          { type: "textarea", name: "alertNotes", label: "Notes" },
        ],
      },
      {
        number: "6.4",
        title: "Quarantine",
        blocks: [
          { type: "textarea", name: "quarantineNotes", label: "Notes" },
          { type: "table", name: "holds", columns: [{ key: "item", label: "Item", kind: "text" }, { key: "quantity", label: "Quantity", kind: "text" }, { key: "reason", label: "Reason", kind: "text" }, { key: "status", label: "Status", kind: "text" }] },
        ],
      },
      {
        number: "6.5",
        title: "First Article Verifications",
        blocks: [
          { type: "row", fields: [{ kind: "text", name: "faiSource", label: "Source" }] },
          { type: "table", name: "fai", columns: [{ key: "category", label: "Product category", kind: "text" }, { key: "completed", label: "Completed", kind: "text" }, { key: "passed", label: "Passed", kind: "text" }, { key: "failed", label: "Failed", kind: "text" }, { key: "deviation", label: "Passed w/ deviation", kind: "text" }] },
        ],
      },
      {
        number: "6.6",
        title: "NCRs, CARs, PIRs, and RPNs",
        blocks: [
          { type: "textarea", name: "ncrSummary", label: "NCRs" },
          { type: "textarea", name: "carSummary", label: "CARs and CAPA" },
          { type: "row", fields: [{ kind: "text", name: "rpnSummary", label: "RPNs logged" }] },
          { type: "textarea", name: "pir", label: "PIRs" },
          { type: "table", name: "ncrs", columns: [{ key: "number", label: "NCR number", kind: "text" }, { key: "part", label: "Part number", kind: "text" }, { key: "defect", label: "Description", kind: "text" }, { key: "disposition", label: "Disposition", kind: "text" }, { key: "status", label: "Status", kind: "text" }] },
        ],
      },
      { number: "6.7", title: "Recalls", blocks: [{ type: "row", fields: [{ kind: "text", name: "recallDocs", label: "Recall documents filed" }] }, { type: "textarea", name: "recallNotes", label: "Notes" }] },
      { number: "6.8", title: "NAPA Tech Line / Collabtic", blocks: [{ type: "textarea", name: "tech", label: "Questions and responses" }] },
      {
        number: "6.10",
        title: "OR/NAPA Email Issues",
        blocks: [
          { type: "textarea", name: "emailNotes", label: "Notes" },
          { type: "table", name: "emailChart", columns: [{ key: "month", label: "Month", kind: "text" }, { key: "total", label: "Total", kind: "text" }, { key: "oreilly", label: "O'Reilly", kind: "text" }, { key: "napa", label: "NAPA", kind: "text" }] },
        ],
      },
      { number: "6.11", title: "Field questions", blocks: [{ type: "textarea", name: "field", label: "Notes" }] },
      { number: "6.12", title: "Fitment Verification", blocks: [{ type: "textarea", name: "fitment", label: "Questions and responses" }] },
      { number: "6.13", title: "Product Information", blocks: [{ type: "textarea", name: "productInfo", label: "Questions and responses" }] },
      { number: "6.14", title: "NAPA black label pallet work", blocks: [{ type: "textarea", name: "pallet", label: "Notes" }] },
    ],
  };

  return renderFormLayoutAsPdf(layout, data, frame);
}
