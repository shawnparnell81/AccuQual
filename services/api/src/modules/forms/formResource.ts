import type { ResourceKey } from "../../middleware/departmentAccess.js";
import { FORM_TYPES } from "./forms.validation.js";

/**
 * Form type -> the module that already gates that record.
 * Reads, history, and export use the same audience as that module.
 */
export const FORM_TYPE_TO_RESOURCE: Partial<Record<(typeof FORM_TYPES)[number], ResourceKey>> = {
  ncr: "ncr",
  five_why: "ncr",
  capa: "capa",
  eight_d: "eight_d",
  audit_checklist: "audit",
  audit_plan: "audit",
  lpa: "audit",
  discrepancy_inspection: "di",
  supplier: "suppliers",
  approved_vendor_list: "suppliers",
  training: "training",
  competency_matrix: "training",
  change: "change",
  pcn: "change",
  calibration: "calibration",
  gage_rr: "calibration",
  maintenance_work_order: "calibration",
  complaint: "complaints",
  fmea: "risk",
  document_control_index: "documents",
  production_log: "production_log",
  daily_production_log: "production_log",
  production_output_log: "production_log",
  appearance_approval: "ppap",
  apqp_summary: "ppap",
  control_plan: "ppap",
  dimensional_report: "ppap",
  process_flow_diagram: "ppap",
  dvpr: "ppap",
  final_inspection_release_checklist: "ppap",
  management_review: "management_review",
  management_review_minutes: "management_review",
  staff_meeting_minutes: "management_review",
  context_of_organization: "context_of_org",
  pareto_chart: "ncr",
};

export function resourceForFormType(formType: string): ResourceKey | undefined {
  return FORM_TYPE_TO_RESOURCE[formType as (typeof FORM_TYPES)[number]];
}
