import type { FormLayout } from "./types.js";
import { calibrationLayout } from "./calibration.js";
import { trainingLayout } from "./training.js";
import { capaLayout } from "./capa.js";
import { ncrLayout } from "./ncr.js";
import { fmeaLayout } from "./fmea.js";
import { appearanceApprovalLayout } from "./appearanceApproval.js";
import { apqpSummaryLayout } from "./apqpSummary.js";
import { controlPlanLayout } from "./controlPlan.js";
import { dimensionalReportLayout } from "./dimensionalReport.js";
import { lpaLayout } from "./lpa.js";
import { processFlowDiagramLayout } from "./processFlowDiagram.js";
import { pcnLayout } from "./productProcessChangeNotice.js";
import { productionLogLayout } from "./productionLog.js";
import { dailyProductionLogLayout } from "./dailyProductionLog.js";
import { approvedVendorListLayout } from "./approvedVendorList.js";
import { competencyMatrixLayout } from "./competencyMatrix.js";
import { documentControlIndexLayout } from "./documentControlIndex.js";
import { contextOfOrganizationLayout } from "./contextOfOrganization.js";
import { dvprLayout } from "./dvpr.js";
import { managementReviewLayout } from "./managementReview.js";
import { maintenanceWorkOrderLayout } from "./maintenanceWorkOrder.js";
import { productionOutputLogLayout } from "./productionOutputLog.js";
import { internalAuditPlanLayout } from "./internalAuditPlan.js";
import { discrepancyInspectionLayout } from "./discrepancyInspection.js";
import { managementReviewMinutesLayout } from "./managementReviewMinutes.js";
import { staffMeetingMinutesLayout } from "./staffMeetingMinutes.js";
import { finalInspectionReleaseChecklistLayout } from "./finalInspectionReleaseChecklist.js";
import { gageRRLayout } from "./gageRR.js";
import { paretoChartLayout } from "./paretoChart.js";
import { inventoryItemLayout } from "./inventoryItem.js";
import { customerRequirementsLayout } from "./customerRequirements.js";
import { auditChecklistLayout } from "./auditChecklist.js";

/**
 * formType -> layout, for every form we've derived from a real pasted
 * document so far. `gage_rr` and `pareto_chart` are export-only here — their
 * on-screen editor is a bespoke component (apps/web's customForms/), so this
 * file is deliberately NOT a 1:1 mirror of apps/web's layouts/index.ts for
 * those two keys; every other key is kept in sync as usual. `audit_checklist`
 * is the one exception to "derived from a real pasted document" — see its
 * own file's header comment for why.
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
  audit_checklist: auditChecklistLayout,
  discrepancy_inspection: discrepancyInspectionLayout,
  management_review_minutes: managementReviewMinutesLayout,
  staff_meeting_minutes: staffMeetingMinutesLayout,
  final_inspection_release_checklist: finalInspectionReleaseChecklistLayout,
  gage_rr: gageRRLayout,
  pareto_chart: paretoChartLayout,
  inventory_item: inventoryItemLayout,
  customer_requirements: customerRequirementsLayout,
};

export function getFormLayout(formType: string): FormLayout | undefined {
  return FORM_LAYOUTS[formType];
}

export * from "./types.js";
