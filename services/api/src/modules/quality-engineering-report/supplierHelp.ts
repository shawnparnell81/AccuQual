/**
 * Supplier upload columns for the Quality / Engineering monthly report.
 * One CSV with a `dataset` column, or an Excel workbook with one sheet per dataset.
 * Labor and warranty dollars come from AccuQual, not from this file.
 */

export interface SupplierColumnDoc {
  dataset: string;
  purpose: string;
  columns: string[];
}

export const SUPPLIER_COLUMNS: SupplierColumnDoc[] = [
  {
    dataset: "monthly_metrics",
    purpose: "Claim count and product-alert count for each month in the trend table.",
    columns: ["month (YYYY-MM)", "total_claims", "total_product_alerts"],
  },
  {
    dataset: "warranty_metrics",
    purpose: "Labor-to-parts ratio, mean time to failure (days), and median time to failure (days). Use a blank cell when the month has no median.",
    columns: ["month", "labor_to_parts_ratio", "mean_time_to_failure_days", "median_time_to_failure_days"],
  },
  {
    dataset: "claims_series",
    purpose: "Claims and returns chart. One row per day (or week) inside the report month.",
    columns: ["date (YYYY-MM-DD)", "claims", "returns"],
  },
  {
    dataset: "top_parts",
    purpose: "Top returning parts table.",
    columns: ["part_number", "description", "total_claims"],
  },
  {
    dataset: "top_vehicles",
    purpose: "Top vehicle models bar chart.",
    columns: ["vehicle", "claims"],
  },
  {
    dataset: "fuel_pump_returns",
    purpose: "Fuel pump return breakdown (executive summary and the returns chart).",
    columns: ["source", "count"],
  },
  {
    dataset: "executive",
    purpose: "One key/value row per figure: raw_claim_count, tracker_processed, flat_rate, potential_liability, claims_approved, claims_denied, claims_pending, denied_labor_savings, department_status (green, yellow, or red).",
    columns: ["key", "value"],
  },
  {
    dataset: "product_alerts",
    purpose: "Section 6.3 totals from the supplier tracker. Hours and average close time are not taken from AccuQual documents.",
    columns: ["total", "open_count", "hours_spent", "avg_days_to_close"],
  },
  {
    dataset: "fai_categories",
    purpose: "First-article pass/fail by product category. When this sheet is present it is the FAI table. When it is absent, the report counts first articles already in AccuQual for the month.",
    columns: ["category", "total_completed", "passed", "failed", "passed_with_deviation"],
  },
  {
    dataset: "email_issues",
    purpose: "OR/NAPA email issues bar chart.",
    columns: ["month", "total_issues", "or_issues", "napa_issues"],
  },
  {
    dataset: "notes",
    purpose: "Optional narrative seed. section is one of: primary_achievement, critical_risk, payout_policy, rca, recommendation, product_alert_notes, quarantine, recalls, email_issues, field_question, pallet, tech_line, fitment, product_info. Question-and-answer sections use problem and response. Other sections use problem as the paragraph.",
    columns: ["section", "problem", "response"],
  },
];

export const SUPPLIER_UPLOAD_NOTE =
  "Return charts and the FAI category sheet are filled from this upload. Labor Claims and Warranty dollars come from AccuQual. NCR, quarantine, CAPA/SCAR, RPN, product-alert documents, and recall documents are read from AccuQual for the selected month when you can open those modules. Empty modules are not turned into claim counts. The August 2026 template carries that month's published claim counts, parts, vehicles, fuel-pump split, FAI categories, and narrative. Its daily claims/returns rows are format examples (the chart image had no data table). Email-issue heights were read from that chart.";
