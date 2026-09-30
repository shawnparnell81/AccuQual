import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { ProtectedRoute } from "./components/layout/ProtectedRoute";
import { RequireFreshPassword } from "./components/auth/RequireFreshPassword";
import { RequireSignaturePin } from "./components/auth/RequireSignaturePin";
import { LoginPage } from "./routes/Auth/LoginPage";
import { ForgotPasswordPage } from "./routes/Auth/ForgotPasswordPage";
import { ResetPasswordPage } from "./routes/Auth/ResetPasswordPage";
import { ForcePasswordChangePage } from "./routes/Auth/ForcePasswordChangePage";
import { SetSignaturePinPage } from "./routes/Auth/SetSignaturePinPage";
import { homeKind } from "./lib/opsLanguage";
import { useCurrentUser, useAuthBootstrap } from "./hooks/useAuth";
import {
  AdminAiSettingsPage,
  AdminAiUsagePage,
  AdminApiDocsPage,
  AuditLogPage,
  AdminCompanyAiConfigPage,
  AdminCompanyBrandingPage,
  AdminCompanySettingsPage,
  AdminCompanyTemplatesPage,
  AdminConsoleHomePage,
  AdminConsoleLayout,
  AdminDataExportPage,
  AdminDigitalTwinSetupPage,
  AdminPlantsPage,
  AdminQualitySettingsPage,
  AdminReceivingInventorySettingsPage,
  AdminSsoPage,
  AdminSupplierSettingsPage,
  AdminSystemHealthPage,
  AdminImportPage,
  AdminUsersRolesPage,
  AiInsightsPage,
  AuditDetailPage,
  AuditsPage,
  CalendarPage,
  CapaDetailPage,
  CapaListPage,
  ChangeDetailPage,
  ChangePage,
  ControlledDocumentPage,
  CrarDetailPage,
  CrarListPage,
  DashboardPage,
  DigitalTwinPage,
  DocumentCategoryPage,
  DocumentChangeRequestDetailPage,
  DocumentChangeRequestsPage,
  DocumentDetailPage,
  DocumentsPage,
  EightDDetailPage,
  EightDPage,
  ErpPresetEditorPage,
  ErpPresetsListPage,
  ErpSyncErrorsPage,
  ValidationReportDetailPage,
  IsoFormListPage,
  IsoFormDetailPage,
  MasterEquipmentListPage,
  MasterDocumentListPage,
  EmployeeTrainingHistoryPage,
  EquipmentDetailPage,
  FeasibilityDetailPage,
  FeasibilityPage,
  FolderExplorerPage,
  GeneralUploadsPage,
  HomePage,
  ManagementSystemPage,
  NavigationSettingsPage,
  NcrListPage,
  NcrWorkspacePage,
  NotificationsPage,
  ParetoAnalysisPage,
  PpapDetailPage,
  PpapListPage,
  QmsFormRecordPage,
  QmsFormTypePage,
  QmsFormsLibraryPage,
  QualityInspectionReportDetailPage,
  QualityInspectionReportsPage,
  QuarantineDetailPage,
  QuarantinePage,
  ReportingHubPage,
  RetiredModulePage,
  RiskDashboardPage,
  RiskDetailPage,
  RiskPage,
  RmaDetailPage,
  RolesPermissionsPage,
  ScarFormDetailPage,
  ScarFormsPage,
  SettingsPage,
  SupplierDetailPage,
  SupplierPortalHome,
  SuppliersPage,
  TrainingDetailPage,
  TrainingPage,
  WarrantyClaimDetail,
  WarrantyClaimsList,
  WarrantyDashboard,
  WorkOrderDetailPage,
  WorkerDetailPage,
  WorkersPage,
  WorkflowBuilderPage,
  WorkflowCanvasPage,
  CalibrationPage,
} from "./routes/pages";

function HomeRoute() {
  const user = useCurrentUser();
  // Quality leads and admins get the plant-wide pulse; everyone else lands on their own day.
  return homeKind(user?.roleName) === "lead" ? <DashboardPage /> : <HomePage />;
}

export function App() {
  useAuthBootstrap();
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/change-password" element={<ForcePasswordChangePage />} />
        <Route element={<RequireFreshPassword />}>
        <Route path="/set-signature-pin" element={<SetSignaturePinPage />} />
        <Route element={<RequireSignaturePin />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/audit-log" element={<AuditLogPage />} />

          <Route path="/ncr" element={<NcrListPage />} />
          <Route path="/ncr/:id" element={<NcrWorkspacePage />} />

          <Route path="/capa" element={<CapaListPage />} />
          <Route path="/capa/:id" element={<CapaDetailPage />} />

          <Route path="/8d" element={<EightDPage />} />
          <Route path="/8d/:id" element={<EightDDetailPage />} />

          <Route path="/validation-reports/:id" element={<ValidationReportDetailPage />} />
          <Route path="/iso-forms/record/:id" element={<IsoFormDetailPage />} />
          <Route path="/iso-forms/:formKey" element={<IsoFormListPage />} />

          <Route path="/audits" element={<AuditsPage />} />
          <Route path="/audits/:id" element={<AuditDetailPage />} />

          <Route path="/quality" element={<Navigate to="/ncr" replace />} />
          <Route path="/quality/:id" element={<Navigate to="/ncr" replace />} />

          <Route path="/folders/:category" element={<DocumentCategoryPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/documents/master-list" element={<MasterDocumentListPage />} />
          <Route path="/documents/folders" element={<FolderExplorerPage />} />
          <Route path="/documents/uploads" element={<GeneralUploadsPage />} />
          <Route path="/documents/:id" element={<DocumentDetailPage />} />
          <Route path="/training" element={<TrainingPage />} />
          <Route path="/training/employee/:userId" element={<EmployeeTrainingHistoryPage />} />
          <Route path="/training/:id" element={<TrainingDetailPage />} />
          <Route path="/workers" element={<WorkersPage />} />
          <Route path="/workers/:id" element={<WorkerDetailPage />} />
          <Route path="/change" element={<ChangePage />} />
          <Route path="/change/:id" element={<ChangeDetailPage />} />
          <Route path="/risk" element={<RiskPage />} />
          <Route path="/risk/dashboard" element={<RiskDashboardPage />} />
          <Route path="/risk/:id" element={<RiskDetailPage />} />
          <Route path="/feasibility" element={<FeasibilityPage />} />
          <Route path="/feasibility/:id" element={<FeasibilityDetailPage />} />
          <Route path="/sales" element={<Navigate to="/" replace />} />
          <Route path="/sales/dashboard" element={<Navigate to="/" replace />} />
          <Route path="/sales/:id" element={<Navigate to="/" replace />} />
          <Route path="/customers" element={<Navigate to="/" replace />} />
          <Route path="/customers/dashboard" element={<Navigate to="/" replace />} />
          <Route path="/customers/:id" element={<Navigate to="/" replace />} />
          <Route path="/document-change-requests" element={<DocumentChangeRequestsPage />} />
          <Route path="/document-change-requests/:id" element={<DocumentChangeRequestDetailPage />} />
          <Route path="/qms-forms" element={<QmsFormsLibraryPage />} />
          <Route path="/qms-forms/:formType" element={<QmsFormTypePage />} />
          <Route path="/qms-forms/:formType/:id" element={<QmsFormRecordPage />} />
          <Route path="/scar-forms" element={<ScarFormsPage />} />
          <Route path="/scar-forms/:id" element={<ScarFormDetailPage />} />
          <Route path="/quality-inspection-reports" element={<QualityInspectionReportsPage />} />
          <Route path="/quality-inspection-reports/:id" element={<QualityInspectionReportDetailPage />} />
          <Route path="/ppap" element={<PpapListPage />} />
          <Route path="/ppap/:id" element={<PpapDetailPage />} />
          <Route path="/production-logs" element={<RetiredModulePage name="Production" />} />
          <Route path="/management-system" element={<ManagementSystemPage />} />
          <Route
            path="/management-system/management-review"
            element={<ControlledDocumentPage basePath="/management-review" formType="management_review" title="Management Review" noun="management review" description="Management system performance evaluation — strategic core review inputs and the action items they produce." />}
          />
          <Route
            path="/management-system/context"
            element={<ControlledDocumentPage basePath="/context" formType="context_of_organization" title="Context of the Organization" noun="context analysis" description="ISO 9001 clause 4.1 — internal strengths and weaknesses, external opportunities and threats, by interested party." />}
          />
          <Route path="/pareto" element={<ParetoAnalysisPage />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/suppliers/:id" element={<SupplierDetailPage />} />
          <Route path="/calibration" element={<CalibrationPage />} />
          <Route path="/calibration/master-list" element={<MasterEquipmentListPage />} />
          <Route path="/calibration/:id" element={<EquipmentDetailPage />} />
          <Route path="/quarantine" element={<QuarantinePage />} />
          <Route path="/quarantine/:id" element={<QuarantineDetailPage />} />
          <Route path="/complaints" element={<Navigate to="/ncr" replace />} />
          <Route path="/complaints/:id" element={<Navigate to="/ncr" replace />} />
          <Route path="/inventory/*" element={<RetiredModulePage name="Inventory" />} />
          <Route path="/erp/*" element={<RetiredModulePage name="ERP" />} />
          <Route path="/erp" element={<RetiredModulePage name="ERP" />} />
          <Route path="/rma" element={<RetiredModulePage name="RMA" />} />
          <Route path="/rma/:id" element={<RmaDetailPage />} />
          <Route path="/warranty" element={<WarrantyClaimsList />} />
          <Route path="/warranty/dashboard" element={<WarrantyDashboard />} />
          <Route path="/warranty/:id" element={<WarrantyClaimDetail />} />
          <Route path="/crar" element={<CrarListPage />} />
          <Route path="/crar/:id" element={<CrarDetailPage />} />
          <Route path="/rma-activity-log" element={<RetiredModulePage name="RMA activity" />} />
          <Route path="/rma-log/*" element={<RetiredModulePage name="RMA log" />} />
          <Route path="/rma-log" element={<RetiredModulePage name="RMA log" />} />
          <Route path="/supplier-portal" element={<SupplierPortalHome />} />
          <Route path="/work-orders" element={<RetiredModulePage name="Work orders" />} />
          <Route path="/work-orders/:id" element={<WorkOrderDetailPage />} />
          <Route path="/onboarding" element={<Navigate to="/settings" replace />} />

          <Route path="/workflow" element={<WorkflowBuilderPage />} />
          <Route path="/workflow/:id" element={<WorkflowCanvasPage />} />
          <Route path="/ai" element={<AiInsightsPage />} />
          <Route path="/digital-twin" element={<DigitalTwinPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/erp/presets" element={<ErpPresetsListPage />} />
          <Route path="/settings/erp/presets/:id" element={<ErpPresetEditorPage />} />
          <Route path="/settings/erp/sync-errors" element={<ErpSyncErrorsPage />} />
          {/* Kept working as its own URL (embedded as SettingsPage's "Navigation" tab) — anyone with this link bookmarked shouldn't get a 404. */}
          <Route path="/settings/navigation" element={<NavigationSettingsPage />} />
          {/* Kept working as their own URLs — now also reachable/embedded via the Admin Console shell below, not replaced. */}
          <Route path="/admin/company-ai" element={<AdminCompanyAiConfigPage />} />
          <Route path="/admin/ai-usage" element={<AdminAiUsagePage />} />

          {/* Phase 10 — Admin Console: one shell nesting Roles & Permissions, Company Branding/Templates/Digital-Twin-Setup (all pre-existing, unchanged), and the new Users&Roles/AI Settings/Supplier/Quality/Receiving-Inventory/System Health/Company Settings sections. */}
          <Route path="/admin" element={<AdminConsoleLayout />}>
            <Route index element={<AdminConsoleHomePage />} />
            <Route path="users" element={<AdminUsersRolesPage />} />
            <Route path="import" element={<AdminImportPage />} />
            <Route path="plants" element={<AdminPlantsPage />} />
            <Route path="roles-permissions" element={<RolesPermissionsPage />} />
            <Route path="ai-settings" element={<AdminAiSettingsPage />} />
            <Route path="supplier-settings" element={<AdminSupplierSettingsPage />} />
            <Route path="quality-settings" element={<AdminQualitySettingsPage />} />
            <Route path="receiving-inventory-settings" element={<AdminReceivingInventorySettingsPage />} />
            <Route path="system-health" element={<AdminSystemHealthPage />} />
            <Route path="api-docs" element={<AdminApiDocsPage />} />
            <Route path="company-settings" element={<AdminCompanySettingsPage />} />
            <Route path="sso" element={<AdminSsoPage />} />
            <Route path="data-export" element={<AdminDataExportPage />} />
            <Route path="company-branding" element={<AdminCompanyBrandingPage />} />
            <Route path="company-templates" element={<AdminCompanyTemplatesPage />} />
            <Route path="digital-twin" element={<AdminDigitalTwinSetupPage />} />
          </Route>

          <Route path="/reporting" element={<ReportingHubPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
        </Route>
        </Route>
        </Route>
      </Route>
    </Routes>
  );
}
