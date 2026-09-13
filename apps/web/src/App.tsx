import { Routes, Route } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { ProtectedRoute } from "./components/layout/ProtectedRoute";
import { LoginPage } from "./routes/Auth/LoginPage";
import { RegisterPage } from "./routes/Auth/RegisterPage";
import { DashboardPage } from "./routes/Dashboard/DashboardPage";
import { NcrListPage } from "./routes/NCR/NcrListPage";
import { NcrDetailPage } from "./routes/NCR/NcrDetailPage";
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
import { AdminTenantBrandingPage } from "./routes/Admin/AdminTenantBrandingPage";
import { AdminTenantTemplatesPage } from "./routes/Admin/AdminTenantTemplatesPage";
import { AdminTenantAiConfigPage } from "./routes/Admin/AdminTenantAiConfigPage";
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

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/platform" element={<PlatformAdminPage />} />

          <Route path="/ncr" element={<NcrListPage />} />
          <Route path="/ncr/:id" element={<NcrDetailPage />} />

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
          <Route path="/risk/:id" element={<RiskDetailPage />} />
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
          <Route path="/erp/:id" element={<ErpPurchaseOrderDetailPage />} />

          <Route path="/workflow" element={<WorkflowBuilderPage />} />
          <Route path="/ai" element={<AiInsightsPage />} />
          <Route path="/digital-twin" element={<DigitalTwinPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          {/* Kept working as its own URL (embedded as SettingsPage's "Navigation" tab) — anyone with this link bookmarked shouldn't get a 404. */}
          <Route path="/settings/navigation" element={<NavigationSettingsPage />} />
          <Route path="/admin/tenant-branding" element={<AdminTenantBrandingPage />} />
          <Route path="/admin/tenant-templates" element={<AdminTenantTemplatesPage />} />
          <Route path="/admin/tenant-ai" element={<AdminTenantAiConfigPage />} />
          <Route path="/admin/digital-twin" element={<AdminDigitalTwinSetupPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
