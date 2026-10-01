import { lazy, type ComponentType, type LazyExoticComponent } from "react";

const preloaders = new Map<string, () => Promise<unknown>>();

function lazyNamed(path: string, load: () => Promise<Record<string, unknown>>, name: string): LazyExoticComponent<ComponentType<any>> {
  const run = () =>
    load().then((mod) => {
      const component = mod[name];
      if (typeof component !== "function") throw new Error(`Missing page export ${name}`);
      return { default: component as ComponentType<any> };
    });
  if (!preloaders.has(path)) preloaders.set(path, run);
  return lazy(run);
}

/** Starts loading the page for a sidebar path so the click doesn't wait on the network. */
export function prefetchRoute(path: string): void {
  const exact = preloaders.get(path) ?? preloaders.get(path.replace(/\/$/, ""));
  if (exact) {
    void exact();
    return;
  }
  const base = `/${path.split("/").filter(Boolean)[0] ?? ""}`;
  const prefix = preloaders.get(base);
  if (prefix) void prefix();
}

export const AuditLogPage = lazyNamed("/audit-log", () => import("./AuditLog/AuditLogPage"), "AuditLogPage");
export const DashboardPage = lazyNamed("/", () => import("./Dashboard/DashboardPage"), "DashboardPage");
export const HomePage = lazyNamed("/home", () => import("./Home/HomePage"), "HomePage");
export const CalendarPage = lazyNamed("/calendar", () => import("./Calendar/CalendarPage"), "CalendarPage");
export const NcrListPage = lazyNamed("/ncr", () => import("./NCR/NcrListPage"), "NcrListPage");
export const NcrWorkspacePage = lazyNamed("/ncr", () => import("./NCR/NcrWorkspacePage"), "NcrWorkspacePage");
export const CapaListPage = lazyNamed("/capa", () => import("./CAPA/CapaListPage"), "CapaListPage");
export const CapaDetailPage = lazyNamed("/capa", () => import("./CAPA/CapaDetailPage"), "CapaDetailPage");
export const EightDPage = lazyNamed("/8d", () => import("./EightD/EightDPage"), "EightDPage");
export const EightDDetailPage = lazyNamed("/8d", () => import("./EightD/EightDDetailPage"), "EightDDetailPage");
export const ValidationReportDetailPage = lazyNamed("/validation-reports", () => import("./ValidationReports/ValidationReportDetailPage"), "ValidationReportDetailPage");
export const IsoFormListPage = lazyNamed("/iso-forms", () => import("./IsoForms/IsoFormListPage"), "IsoFormListPage");
export const IsoFormDetailPage = lazyNamed("/iso-forms", () => import("./IsoForms/IsoFormDetailPage"), "IsoFormDetailPage");
export const MasterEquipmentListPage = lazyNamed("/calibration/master-list", () => import("./Calibration/MasterEquipmentListPage"), "MasterEquipmentListPage");
export const MasterDocumentListPage = lazyNamed("/documents/master-list", () => import("./Documents/MasterDocumentListPage"), "MasterDocumentListPage");
export const AuditsPage = lazyNamed("/audits", () => import("./Audits/AuditsPage"), "AuditsPage");
export const BlankFormsPage = lazyNamed("/blank-forms", () => import("./BlankForms/BlankFormsPage"), "BlankFormsPage");
export const AuditDetailPage = lazyNamed("/audits", () => import("./Audits/AuditDetailPage"), "AuditDetailPage");
export const DocumentsPage = lazyNamed("/documents", () => import("./Documents/DocumentsPage"), "DocumentsPage");
export const QuarantinePage = lazyNamed("/quarantine", () => import("./Quarantine/QuarantinePage"), "QuarantinePage");
export const QuarantineDetailPage = lazyNamed("/quarantine", () => import("./Quarantine/QuarantineDetailPage"), "QuarantineDetailPage");
export const DocumentDetailPage = lazyNamed("/documents", () => import("./Documents/DocumentDetailPage"), "DocumentDetailPage");
export const FolderExplorerPage = lazyNamed("/documents/folders", () => import("./Documents/FolderExplorerPage"), "FolderExplorerPage");
export const GeneralUploadsPage = lazyNamed("/documents/uploads", () => import("./Documents/GeneralUploadsPage"), "GeneralUploadsPage");
export const TrainingPage = lazyNamed("/training", () => import("./Training/TrainingPage"), "TrainingPage");
export const TrainingDetailPage = lazyNamed("/training", () => import("./Training/TrainingDetailPage"), "TrainingDetailPage");
export const WorkersPage = lazyNamed("/workers", () => import("./Workers/WorkersPage"), "WorkersPage");
export const WorkerDetailPage = lazyNamed("/workers", () => import("./Workers/WorkerDetailPage"), "WorkerDetailPage");
export const EmployeeTrainingHistoryPage = lazyNamed("/training/employee", () => import("./Training/EmployeeTrainingHistoryPage"), "EmployeeTrainingHistoryPage");
export const ChangePage = lazyNamed("/change", () => import("./Change/ChangePage"), "ChangePage");
export const ChangeDetailPage = lazyNamed("/change", () => import("./Change/ChangeDetailPage"), "ChangeDetailPage");
export const RiskPage = lazyNamed("/risk", () => import("./Risk/RiskPage"), "RiskPage");
export const RiskDetailPage = lazyNamed("/risk", () => import("./Risk/RiskDetailPage"), "RiskDetailPage");
export const RiskDashboardPage = lazyNamed("/risk/dashboard", () => import("./Risk/RiskDashboardPage"), "RiskDashboardPage");
export const FeasibilityPage = lazyNamed("/feasibility", () => import("./Feasibility/FeasibilityPage"), "FeasibilityPage");
export const FeasibilityDetailPage = lazyNamed("/feasibility", () => import("./Feasibility/FeasibilityDetailPage"), "FeasibilityDetailPage");
export const DocumentChangeRequestsPage = lazyNamed("/document-change-requests", () => import("./DocumentChangeRequests/DocumentChangeRequestsPage"), "DocumentChangeRequestsPage");
export const DocumentChangeRequestDetailPage = lazyNamed("/document-change-requests", () => import("./DocumentChangeRequests/DocumentChangeRequestDetailPage"), "DocumentChangeRequestDetailPage");
export const QmsFormsLibraryPage = lazyNamed("/qms-forms", () => import("./QmsForms/QmsFormsLibraryPage"), "QmsFormsLibraryPage");
export const QmsFormTypePage = lazyNamed("/qms-forms", () => import("./QmsForms/QmsFormTypePage"), "QmsFormTypePage");
export const QmsFormRecordPage = lazyNamed("/qms-forms", () => import("./QmsForms/QmsFormRecordPage"), "QmsFormRecordPage");
export const ScarFormsPage = lazyNamed("/scar-forms", () => import("./ScarForms/ScarFormsPage"), "ScarFormsPage");
export const ScarFormDetailPage = lazyNamed("/scar-forms", () => import("./ScarForms/ScarFormDetailPage"), "ScarFormDetailPage");
export const QualityInspectionReportsPage = lazyNamed("/quality-inspection-reports", () => import("./QualityInspectionReports/QualityInspectionReportsPage"), "QualityInspectionReportsPage");
export const QualityInspectionReportDetailPage = lazyNamed("/quality-inspection-reports", () => import("./QualityInspectionReports/QualityInspectionReportDetailPage"), "QualityInspectionReportDetailPage");
export const PpapListPage = lazyNamed("/ppap", () => import("./Ppap/PpapListPage"), "PpapListPage");
export const PpapDetailPage = lazyNamed("/ppap", () => import("./Ppap/PpapDetailPage"), "PpapDetailPage");
export const NotificationsPage = lazyNamed("/notifications", () => import("./Notifications/NotificationsPage"), "NotificationsPage");
export const RetiredModulePage = lazyNamed("/production-logs", () => import("./Retired/RetiredModulePage"), "RetiredModulePage");
export const SuppliersPage = lazyNamed("/suppliers", () => import("./Suppliers/SuppliersPage"), "SuppliersPage");
export const SupplierDetailPage = lazyNamed("/suppliers", () => import("./Suppliers/SupplierDetailPage"), "SupplierDetailPage");
export const SupplierPortalHome = lazyNamed("/supplier-portal", () => import("./SupplierPortal/SupplierPortalHome"), "SupplierPortalHome");
export const CalibrationPage = lazyNamed("/calibration", () => import("./Calibration/CalibrationPage"), "CalibrationPage");
export const EquipmentDetailPage = lazyNamed("/calibration", () => import("./Calibration/EquipmentDetailPage"), "EquipmentDetailPage");
export const DocumentCategoryPage = lazyNamed("/folders", () => import("./Documents/DocumentCategoryPage"), "DocumentCategoryPage");
export const ManagementSystemPage = lazyNamed("/management-system", () => import("./ManagementSystem/ManagementSystemPage"), "ManagementSystemPage");
export const ControlledDocumentPage = lazyNamed("/management-system", () => import("./ManagementSystem/ControlledDocumentPage"), "ControlledDocumentPage");
export const ParetoAnalysisPage = lazyNamed("/pareto", () => import("./Pareto/ParetoAnalysisPage"), "ParetoAnalysisPage");
export const WorkflowBuilderPage = lazyNamed("/workflow", () => import("./Workflow/WorkflowBuilderPage"), "WorkflowBuilderPage");
export const WorkflowCanvasPage = lazyNamed("/workflow", () => import("./Workflow/WorkflowCanvasPage"), "WorkflowCanvasPage");
export const AiInsightsPage = lazyNamed("/ai", () => import("./AI/AiInsightsPage"), "AiInsightsPage");
export const DigitalTwinPage = lazyNamed("/digital-twin", () => import("./DigitalTwin/DigitalTwinPage"), "DigitalTwinPage");
export const ReportingHubPage = lazyNamed("/reporting", () => import("./Reporting/ReportingHubPage"), "ReportingHubPage");
export const ReportsPage = lazyNamed("/reports", () => import("./Reports/ReportsPage"), "ReportsPage");
export const NavigationSettingsPage = lazyNamed("/settings/navigation", () => import("./Settings/NavigationSettingsPage"), "NavigationSettingsPage");
export const SettingsPage = lazyNamed("/settings", () => import("./Settings/SettingsPage"), "SettingsPage");
export const ErpPresetsListPage = lazyNamed("/settings/erp/presets", () => import("./Erp/ErpPresetsListPage"), "ErpPresetsListPage");
export const ErpPresetEditorPage = lazyNamed("/settings/erp/presets", () => import("./Erp/ErpPresetEditorPage"), "ErpPresetEditorPage");
export const ErpSyncErrorsPage = lazyNamed("/settings/erp/sync-errors", () => import("./Erp/ErpSyncErrorsPage"), "ErpSyncErrorsPage");
export const RmaDetailPage = lazyNamed("/rma", () => import("./Rma/RmaDetailPage"), "RmaDetailPage");
export const WarrantyClaimsList = lazyNamed("/warranty", () => import("./Warranty/WarrantyClaimsList"), "WarrantyClaimsList");
export const WarrantyClaimDetail = lazyNamed("/warranty", () => import("./Warranty/WarrantyClaimDetail"), "WarrantyClaimDetail");
export const WarrantyDashboard = lazyNamed("/warranty/dashboard", () => import("./Warranty/WarrantyDashboard"), "WarrantyDashboard");
export const CrarListPage = lazyNamed("/crar", () => import("./Crar/CrarListPage"), "CrarListPage");
export const CrarDetailPage = lazyNamed("/crar", () => import("./Crar/CrarDetailPage"), "CrarDetailPage");
export const WorkOrderDetailPage = lazyNamed("/work-orders", () => import("./WorkOrders/WorkOrderDetailPage"), "WorkOrderDetailPage");
export const AdminCompanyBrandingPage = lazyNamed("/admin/company-branding", () => import("./Admin/AdminCompanyBrandingPage"), "AdminCompanyBrandingPage");
export const AdminCompanyTemplatesPage = lazyNamed("/admin/company-templates", () => import("./Admin/AdminCompanyTemplatesPage"), "AdminCompanyTemplatesPage");
export const AdminCompanyAiConfigPage = lazyNamed("/admin/company-ai", () => import("./Admin/AdminCompanyAiConfigPage"), "AdminCompanyAiConfigPage");
export const AdminAiUsagePage = lazyNamed("/admin/ai-usage", () => import("./Admin/AdminAiUsagePage"), "AdminAiUsagePage");
export const AdminDigitalTwinSetupPage = lazyNamed("/admin/digital-twin", () => import("./Admin/AdminDigitalTwinSetupPage"), "AdminDigitalTwinSetupPage");
export const RolesPermissionsPage = lazyNamed("/admin/roles-permissions", () => import("./Admin/RolesPermissionsPage"), "RolesPermissionsPage");
export const AdminConsoleLayout = lazyNamed("/admin", () => import("./Admin/AdminConsoleLayout"), "AdminConsoleLayout");
export const AdminConsoleHomePage = lazyNamed("/admin", () => import("./Admin/AdminConsoleHomePage"), "AdminConsoleHomePage");
export const AdminUsersRolesPage = lazyNamed("/admin/users", () => import("./Admin/AdminUsersRolesPage"), "AdminUsersRolesPage");
export const AdminImportPage = lazyNamed("/admin/import", () => import("./Admin/AdminImportPage"), "AdminImportPage");
export const AdminPlantsPage = lazyNamed("/admin/plants", () => import("./Admin/AdminPlantsPage"), "AdminPlantsPage");
export const AdminAiSettingsPage = lazyNamed("/admin/ai-settings", () => import("./Admin/AdminAiSettingsPage"), "AdminAiSettingsPage");
export const AdminSupplierSettingsPage = lazyNamed("/admin/supplier-settings", () => import("./Admin/AdminSupplierSettingsPage"), "AdminSupplierSettingsPage");
export const AdminQualitySettingsPage = lazyNamed("/admin/quality-settings", () => import("./Admin/AdminQualitySettingsPage"), "AdminQualitySettingsPage");
export const AdminReceivingInventorySettingsPage = lazyNamed("/admin/receiving-inventory-settings", () => import("./Admin/AdminReceivingInventorySettingsPage"), "AdminReceivingInventorySettingsPage");
export const AdminSystemHealthPage = lazyNamed("/admin/system-health", () => import("./Admin/AdminSystemHealthPage"), "AdminSystemHealthPage");
export const AdminApiDocsPage = lazyNamed("/admin/api-docs", () => import("./Admin/AdminApiDocsPage"), "AdminApiDocsPage");
export const AdminCompanySettingsPage = lazyNamed("/admin/company-settings", () => import("./Admin/AdminCompanySettingsPage"), "AdminCompanySettingsPage");
export const AdminSsoPage = lazyNamed("/admin/sso", () => import("./Admin/AdminSsoPage"), "AdminSsoPage");
export const AdminDataExportPage = lazyNamed("/admin/data-export", () => import("./Admin/AdminDataExportPage"), "AdminDataExportPage");
