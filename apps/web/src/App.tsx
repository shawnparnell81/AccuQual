import { Routes, Route } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { ProtectedRoute } from "./components/layout/ProtectedRoute";
import { LoginPage } from "./routes/Auth/LoginPage";
import { RegisterPage } from "./routes/Auth/RegisterPage";
import { ForgotPasswordPage } from "./routes/Auth/ForgotPasswordPage";
import { ResetPasswordPage } from "./routes/Auth/ResetPasswordPage";
import { DashboardPage } from "./routes/Dashboard/DashboardPage";
import { NcrListPage } from "./routes/NCR/NcrListPage";
import { NcrWorkspacePage } from "./routes/NCR/NcrWorkspacePage";
import { CapaListPage } from "./routes/CAPA/CapaListPage";
import { CapaDetailPage } from "./routes/CAPA/CapaDetailPage";
import { EightDPage } from "./routes/EightD/EightDPage";
import { EightDDetailPage } from "./routes/EightD/EightDDetailPage";
import { AuditsPage } from "./routes/Audits/AuditsPage";
import { AuditDetailPage } from "./routes/Audits/AuditDetailPage";
import { DocumentsPage } from "./routes/Documents/DocumentsPage";
import { DocumentDetailPage } from "./routes/Documents/DocumentDetailPage";
import { FolderExplorerPage } from "./routes/Documents/FolderExplorerPage";
import { TrainingPage } from "./routes/Training/TrainingPage";
import { TrainingDetailPage } from "./routes/Training/TrainingDetailPage";
import { EmployeeTrainingHistoryPage } from "./routes/Training/EmployeeTrainingHistoryPage";
import { ChangePage } from "./routes/Change/ChangePage";
import { ChangeDetailPage } from "./routes/Change/ChangeDetailPage";
import { RiskPage } from "./routes/Risk/RiskPage";
import { RiskDetailPage } from "./routes/Risk/RiskDetailPage";
import { RiskDashboardPage } from "./routes/Risk/RiskDashboardPage";
import { FeasibilityPage } from "./routes/Feasibility/FeasibilityPage";
import { FeasibilityDetailPage } from "./routes/Feasibility/FeasibilityDetailPage";
import { FeasibilityDashboardPage } from "./routes/Feasibility/FeasibilityDashboardPage";
import { SalesAccountsPage } from "./routes/Sales/SalesAccountsPage";
import { SalesAccountDetailPage } from "./routes/Sales/SalesAccountDetailPage";
import { SalesDashboardPage } from "./routes/Sales/SalesDashboardPage";
import { CustomersPage } from "./routes/Customers/CustomersPage";
import { CustomerDetailPage } from "./routes/Customers/CustomerDetailPage";
import { CustomerDashboardPage } from "./routes/Customers/CustomerDashboardPage";
import { DocumentChangeRequestsPage } from "./routes/DocumentChangeRequests/DocumentChangeRequestsPage";
import { DocumentChangeRequestDetailPage } from "./routes/DocumentChangeRequests/DocumentChangeRequestDetailPage";
import { QmsFormsLibraryPage } from "./routes/QmsForms/QmsFormsLibraryPage";
import { QmsFormTypePage } from "./routes/QmsForms/QmsFormTypePage";
import { QmsFormRecordPage } from "./routes/QmsForms/QmsFormRecordPage";
import { ScarFormsPage } from "./routes/ScarForms/ScarFormsPage";
import { ScarFormDetailPage } from "./routes/ScarForms/ScarFormDetailPage";
import { QualityInspectionReportsPage } from "./routes/QualityInspectionReports/QualityInspectionReportsPage";
import { QualityInspectionReportDetailPage } from "./routes/QualityInspectionReports/QualityInspectionReportDetailPage";
import { PpapListPage } from "./routes/Ppap/PpapListPage";
import { PpapDetailPage } from "./routes/Ppap/PpapDetailPage";
import { ProductionLogsPage } from "./routes/Production/ProductionLogsPage";
import { SuppliersPage } from "./routes/Suppliers/SuppliersPage";
import { SupplierDetailPage } from "./routes/Suppliers/SupplierDetailPage";
import { CalibrationPage } from "./routes/Calibration/CalibrationPage";
import { EquipmentDetailPage } from "./routes/Calibration/EquipmentDetailPage";
import { ComplaintsPage } from "./routes/Complaints/ComplaintsPage";
import { ComplaintDetailPage } from "./routes/Complaints/ComplaintDetailPage";
import { ManagementSystemPage } from "./routes/ManagementSystem/ManagementSystemPage";
import { QualityPage } from "./routes/Quality/QualityPage";
import { QualityDetailPage } from "./routes/Quality/QualityDetailPage";
import { ParetoAnalysisPage } from "./routes/Pareto/ParetoAnalysisPage";
import { WorkflowBuilderPage } from "./routes/Workflow/WorkflowBuilderPage";
import { AiInsightsPage } from "./routes/AI/AiInsightsPage";
import { DigitalTwinPage } from "./routes/DigitalTwin/DigitalTwinPage";
import { PlatformAdminPage } from "./routes/Platform/PlatformAdminPage";
import { NavigationSettingsPage } from "./routes/Settings/NavigationSettingsPage";
import { SettingsPage } from "./routes/Settings/SettingsPage";
import { InventoryListPage } from "./routes/Inventory/InventoryListPage";
import { InventoryDetailPage } from "./routes/Inventory/InventoryDetailPage";
import { InventoryAlertsPage } from "./routes/Inventory/InventoryAlertsPage";
import { ErpPurchaseOrdersPage } from "./routes/Erp/ErpPurchaseOrdersPage";
import { ErpNewPurchaseOrderPage } from "./routes/Erp/ErpNewPurchaseOrderPage";
import { ErpPurchaseOrderDetailPage } from "./routes/Erp/ErpPurchaseOrderDetailPage";
import { RmaListPage } from "./routes/Rma/RmaListPage";
import { RmaDetailPage } from "./routes/Rma/RmaDetailPage";
import { ErpRequisitionsPage } from "./routes/Erp/ErpRequisitionsPage";
import { ErpRequisitionDetailPage } from "./routes/Erp/ErpRequisitionDetailPage";
import { WorkOrderListPage } from "./routes/WorkOrders/WorkOrderListPage";
import { WorkOrderDetailPage } from "./routes/WorkOrders/WorkOrderDetailPage";
import { OnboardingPage } from "./routes/Onboarding/OnboardingPage";
import { AdminTenantBrandingPage } from "./routes/Admin/AdminTenantBrandingPage";
import { AdminTenantTemplatesPage } from "./routes/Admin/AdminTenantTemplatesPage";
import { AdminTenantAiConfigPage } from "./routes/Admin/AdminTenantAiConfigPage";
import { AdminAiUsagePage } from "./routes/Admin/AdminAiUsagePage";
import { AdminDigitalTwinSetupPage } from "./routes/Admin/AdminDigitalTwinSetupPage";
import { useCurrentUser } from "./hooks/useAuth";

function HomeRoute() {
  // Platform admins have no tenant, so every tenant-data page 401s for them —
  // send them straight to the console that's actually theirs.
  const user = useCurrentUser();
  return user?.roleName === "platform_admin" ? <PlatformAdminPage /> : <DashboardPage />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/platform" element={<PlatformAdminPage />} />

          <Route path="/ncr" element={<NcrListPage />} />
          <Route path="/ncr/:id" element={<NcrWorkspacePage />} />

          <Route path="/capa" element={<CapaListPage />} />
          <Route path="/capa/:id" element={<CapaDetailPage />} />

          <Route path="/8d" element={<EightDPage />} />
          <Route path="/8d/:id" element={<EightDDetailPage />} />

          <Route path="/audits" element={<AuditsPage />} />
          <Route path="/audits/:id" element={<AuditDetailPage />} />

          <Route path="/quality" element={<QualityPage />} />
          <Route path="/quality/:id" element={<QualityDetailPage />} />

          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/documents/folders" element={<FolderExplorerPage />} />
          <Route path="/documents/:id" element={<DocumentDetailPage />} />
          <Route path="/training" element={<TrainingPage />} />
          <Route path="/training/employee/:userId" element={<EmployeeTrainingHistoryPage />} />
          <Route path="/training/:id" element={<TrainingDetailPage />} />
          <Route path="/change" element={<ChangePage />} />
          <Route path="/change/:id" element={<ChangeDetailPage />} />
          <Route path="/risk" element={<RiskPage />} />
          <Route path="/risk/dashboard" element={<RiskDashboardPage />} />
          <Route path="/risk/:id" element={<RiskDetailPage />} />
          <Route path="/feasibility" element={<FeasibilityPage />} />
          <Route path="/feasibility/dashboard" element={<FeasibilityDashboardPage />} />
          <Route path="/feasibility/:id" element={<FeasibilityDetailPage />} />
          <Route path="/sales" element={<SalesAccountsPage />} />
          <Route path="/sales/dashboard" element={<SalesDashboardPage />} />
          <Route path="/sales/:id" element={<SalesAccountDetailPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/customers/dashboard" element={<CustomerDashboardPage />} />
          <Route path="/customers/:id" element={<CustomerDetailPage />} />
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
          <Route path="/production-logs" element={<ProductionLogsPage />} />
          <Route path="/management-system" element={<ManagementSystemPage />} />
          <Route path="/pareto" element={<ParetoAnalysisPage />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/suppliers/:id" element={<SupplierDetailPage />} />
          <Route path="/calibration" element={<CalibrationPage />} />
          <Route path="/calibration/:id" element={<EquipmentDetailPage />} />
          <Route path="/complaints" element={<ComplaintsPage />} />
          <Route path="/complaints/:id" element={<ComplaintDetailPage />} />
          <Route path="/inventory" element={<InventoryListPage />} />
          <Route path="/inventory/alerts" element={<InventoryAlertsPage />} />
          <Route path="/inventory/:id" element={<InventoryDetailPage />} />
          <Route path="/erp" element={<ErpPurchaseOrdersPage />} />
          <Route path="/erp/new" element={<ErpNewPurchaseOrderPage />} />
          <Route path="/erp/requisitions" element={<ErpRequisitionsPage />} />
          <Route path="/erp/requisitions/:id" element={<ErpRequisitionDetailPage />} />
          <Route path="/erp/:id" element={<ErpPurchaseOrderDetailPage />} />
          <Route path="/rma" element={<RmaListPage />} />
          <Route path="/rma/:id" element={<RmaDetailPage />} />
          <Route path="/work-orders" element={<WorkOrderListPage />} />
          <Route path="/work-orders/:id" element={<WorkOrderDetailPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />

          <Route path="/workflow" element={<WorkflowBuilderPage />} />
          <Route path="/ai" element={<AiInsightsPage />} />
          <Route path="/digital-twin" element={<DigitalTwinPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          {/* Kept working as its own URL (embedded as SettingsPage's "Navigation" tab) — anyone with this link bookmarked shouldn't get a 404. */}
          <Route path="/settings/navigation" element={<NavigationSettingsPage />} />
          <Route path="/admin/tenant-branding" element={<AdminTenantBrandingPage />} />
          <Route path="/admin/tenant-templates" element={<AdminTenantTemplatesPage />} />
          <Route path="/admin/tenant-ai" element={<AdminTenantAiConfigPage />} />
          <Route path="/admin/ai-usage" element={<AdminAiUsagePage />} />
          <Route path="/admin/digital-twin" element={<AdminDigitalTwinSetupPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
