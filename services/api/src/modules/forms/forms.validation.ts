import { z } from "zod";

/** Every QMS form type AccuQual ships a default template for (see Forms & PDF Engine Spec §1). */
export const FORM_TYPES = [
  "ncr",
  "capa",
  "eight_d",
  "five_why",
  "audit_checklist",
  "audit_plan",
  "discrepancy_inspection",
  "supplier",
  "training",
  "change",
  "calibration",
  "complaint",
  "fmea",
  "appearance_approval",
  "apqp_summary",
  "control_plan",
  "dimensional_report",
  "lpa",
  "process_flow_diagram",
  "pcn",
  "production_log",
  "daily_production_log",
  "approved_vendor_list",
  "competency_matrix",
  "document_control_index",
  "context_of_organization",
  "dvpr",
  "management_review",
  "maintenance_work_order",
  "production_output_log",
  "gage_rr",
  "pareto_chart",
  "management_review_minutes",
  "staff_meeting_minutes",
  "final_inspection_release_checklist",
] as const;

export const formTypeParamSchema = z.object({
  type: z.enum(FORM_TYPES),
  id: z.coerce.number().int().optional(),
});

export const saveFormSchema = z.object({
  entityType: z.string().optional(),
  entityId: z.coerce.number().int().optional(),
  data: z.record(z.string(), z.unknown()),
});
