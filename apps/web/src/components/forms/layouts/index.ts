import type { FormLayout } from "./types";
import { calibrationLayout } from "./calibration";
import { trainingLayout } from "./training";
import { capaLayout } from "./capa";
import { ncrLayout } from "./ncr";
import { fmeaLayout } from "./fmea";
import { appearanceApprovalLayout } from "./appearanceApproval";
import { apqpSummaryLayout } from "./apqpSummary";
import { controlPlanLayout } from "./controlPlan";
import { dimensionalReportLayout } from "./dimensionalReport";
import { lpaLayout } from "./lpa";
import { processFlowDiagramLayout } from "./processFlowDiagram";
import { pcnLayout } from "./productProcessChangeNotice";
import { productionLogLayout } from "./productionLog";
import { dailyProductionLogLayout } from "./dailyProductionLog";
import { approvedVendorListLayout } from "./approvedVendorList";
import { competencyMatrixLayout } from "./competencyMatrix";
import { documentControlIndexLayout } from "./documentControlIndex";
import { contextOfOrganizationLayout } from "./contextOfOrganization";
import { dvprLayout } from "./dvpr";
import { managementReviewLayout } from "./managementReview";
import { maintenanceWorkOrderLayout } from "./maintenanceWorkOrder";
import { productionOutputLogLayout } from "./productionOutputLog";
import { internalAuditPlanLayout } from "./internalAuditPlan";
import { discrepancyInspectionLayout } from "./discrepancyInspection";
import { managementReviewMinutesLayout } from "./managementReviewMinutes";
import { staffMeetingMinutesLayout } from "./staffMeetingMinutes";
import { finalInspectionReleaseChecklistLayout } from "./finalInspectionReleaseChecklist";
import { inventoryItemLayout } from "./inventoryItem";
import { customerRequirementsLayout } from "./customerRequirements";

/**
 * formType -> layout, for every form we've derived from a real pasted
 * document so far — except "gage_rr" and "pareto_chart", whose on-screen
 * editor is a bespoke component (see ../customForms/) because their
 * calculations are whole-table, not row-by-row; the server's mirror of this
 * file registers a plain layout for those two anyway, purely so PDF export
 * has something real to print.
 */
export const FORM_LAYOUTS: Record<string, FormLayout> = {
  calibration: calibrationLayout,
  training: trainingLayout,
  capa: capaLayout,
  ncr: ncrLayout,
  fmea: fmeaLayout,
  appearance_approval: appearanceApprovalLayout,
  apqp_summary: apqpSummaryLayout,
  control_plan: controlPlanLayout,
  dimensional_report: dimensionalReportLayout,
  lpa: lpaLayout,
  process_flow_diagram: processFlowDiagramLayout,
  pcn: pcnLayout,
  production_log: productionLogLayout,
  daily_production_log: dailyProductionLogLayout,
  approved_vendor_list: approvedVendorListLayout,
  competency_matrix: competencyMatrixLayout,
  document_control_index: documentControlIndexLayout,
  context_of_organization: contextOfOrganizationLayout,
  dvpr: dvprLayout,
  management_review: managementReviewLayout,
  maintenance_work_order: maintenanceWorkOrderLayout,
  production_output_log: productionOutputLogLayout,
  audit_plan: internalAuditPlanLayout,
  discrepancy_inspection: discrepancyInspectionLayout,
  management_review_minutes: managementReviewMinutesLayout,
  staff_meeting_minutes: staffMeetingMinutesLayout,
  final_inspection_release_checklist: finalInspectionReleaseChecklistLayout,
  inventory_item: inventoryItemLayout,
  customer_requirements: customerRequirementsLayout,
};

export function getFormLayout(formType: string): FormLayout | undefined {
  return FORM_LAYOUTS[formType];
}

export * from "./types";
