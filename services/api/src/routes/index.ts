import { Router } from "express";
import { authRouter } from "../modules/auth/auth.routes.js";
import { loginHistoryRouter } from "../modules/auth/loginHistory.routes.js";
import { workflowRunsRouter } from "../modules/workflow/workflow.runs.js";
import { dataExportRouter } from "../modules/data-export/dataExport.routes.js";
import { managementReviewRouter, contextRouter } from "../modules/versioning/versioning.routes.js";
import { ssoPublicRouter, ssoAdminRouter } from "../modules/sso/sso.routes.js";
import { usersRouter } from "../modules/users/users.routes.js";
import { sitesRouter } from "../modules/sites/sites.routes.js";
import { rolesRouter } from "../modules/roles/roles.routes.js";
import { documentsRouter } from "../modules/documents/documents.routes.js";
import { controlledListsRouter } from "../modules/controlled-lists/routes.js";
import { documentFilesRouter } from "../modules/documents/documents.versions.routes.js";
import { onlyOfficePublicRouter, onlyOfficeRouter, onlyOfficeStatusRouter } from "../modules/onlyoffice/onlyoffice.routes.js";
import { documentFoldersRouter } from "../modules/document-folders/document-folders.routes.js";
import { ncrRouter } from "../modules/ncr/ncr.routes.js";
import { capaRouter } from "../modules/capa/capa.routes.js";
import { eightDRouter } from "../modules/eight-d/eight-d.routes.js";
import { validationReportsRouter } from "../modules/validation-reports/validation-reports.routes.js";
import { ecrRouter } from "../modules/change-requests/ecr.routes.js";
import { isoQualityFormsRouter } from "../modules/iso-quality-forms/iso-quality-forms.routes.js";
import { auditsRouter } from "../modules/audits/audits.routes.js";
import { trainingRouter } from "../modules/training/training.routes.js";
import { changeRouter } from "../modules/change/change.routes.js";
import { riskRouter } from "../modules/risk/risk.routes.js";
import { ppapRouter } from "../modules/ppap/ppap.routes.js";
import { qualityRouter } from "../modules/quality/quality.routes.js";
import { supplierRouter } from "../modules/supplier/supplier.routes.js";
import { calibrationRouter } from "../modules/calibration/calibration.routes.js";
import { quarantineRouter } from "../modules/quarantine/quarantine.routes.js";
import { complaintsRouter } from "../modules/complaints/complaints.routes.js";
import { workflowRouter } from "../modules/workflow/workflow.routes.js";
// registers the real workflow action handlers (send_email,
// create_ncr, escalate_capa, ai_suggestion, ...) into workflow-engine.ts's
// registry via its module-level registerActionHandler() side effects.
// Imported for that side effect alone (no exports used) — must load
// before any request can reach POST /workflow/:id/run, so it's imported
// right alongside the router it backs, in the one file every real server
// AND every integration test's createApp() both already load.
import "../modules/workflow/workflowActions.js";
import "../modules/csa-fai/csaFai.actions.js";
import "../modules/fuel-pump-fai/fuelPumpFai.actions.js";
import { aiRouter } from "../modules/ai/ai.routes.js";
import { digitalTwinRouter } from "../modules/digital-twin/digital-twin.routes.js";
import { deviceIngestRouter } from "../modules/digital-twin/digital-twin.deviceIngest.routes.js";
import { auditTrailRouter } from "../modules/audit-trail/audit-trail.routes.js";
import { formsRouter } from "../modules/forms/forms.routes.js";
import { navRouter } from "../modules/nav/nav.routes.js";
import { calendarRouter } from "../modules/calendar/calendar.routes.js";
import { workerRouter } from "../modules/worker/worker.routes.js";
import { notificationsRouter } from "../modules/notifications/notification.routes.js";
import { notificationsMeRouter } from "../modules/notifications/notification.me.routes.js";
import { inventoryRouter } from "../modules/inventory/inventory.routes.js";
import { erpRouter } from "../modules/erp/erp.routes.js";
import { erpPresetsRouter } from "../modules/erp/erpPresets.routes.js";
import { erpSyncErrorsRouter } from "../modules/erp/erpSyncErrors.routes.js";
import { companyRouter } from "../modules/company/company.routes.js";
import { searchRouter } from "../modules/search/search.routes.js";
import { rmaRouter } from "../modules/rma/rma.routes.js";
import { workOrdersRouter } from "../modules/work-orders/workOrders.routes.js";
import { feasibilityRouter } from "../modules/feasibility/feasibility.routes.js";
import { documentChangeRequestsRouter } from "../modules/document-change-requests/documentChangeRequests.routes.js";
import { qmsFormsRouter } from "../modules/qms-forms/qmsForms.routes.js";
import { scarFormsRouter } from "../modules/scar-forms/scarForms.routes.js";
import { qualityInspectionReportsRouter } from "../modules/quality-inspection-reports/qualityInspectionReports.routes.js";
import { settingsRouter } from "../modules/settings/settings.routes.js";
import { attachmentsRouter } from "../modules/attachments/attachments.routes.js";
import { importRouter } from "../modules/import/import.routes.js";
import { formImportRouter } from "../modules/form-import/formImport.routes.js";
import { formBuilderRouter } from "../modules/form-builder/routes.js";
import { adminImportRouter } from "../modules/import/adminImport.routes.js";
import { warrantyRouter } from "../modules/warranty/warranty.routes.js";
import { supplierPortalRouter } from "../modules/supplier-portal/supplierPortal.routes.js";
import { crarRouter } from "../modules/crar/crar.routes.js";
import { rmaActivityLogRouter } from "../modules/rma-activity-log/rmaActivityLog.routes.js";
import { rmaLogRouter } from "../modules/rma-log/rmaLog.routes.js";
import { permissionsRouter } from "../modules/permissions/permissions.routes.js";
import { reportingRouter } from "../modules/reporting/reporting.routes.js";
import { reportsRouter } from "../modules/reports/reports.routes.js";
import { systemHealthRouter } from "../modules/system-health/systemHealth.routes.js";
import { contactRouter } from "../modules/contact/contact.routes.js";
import { docsRouter } from "../docs/docs.routes.js";
import { dashboardRouter } from "../modules/dashboard/dashboard.routes.js";
import { faiRouter } from "../modules/fai/fai.routes.js";
import { legalHoldsRouter, pdfExportsRouter } from "../modules/pdf-exports/pdfExport.routes.js";

export const apiRouter = Router();

// Before /auth: /auth/sso/* is its own router (no session yet), and authRouter would otherwise never see it as anything but an unknown path.
apiRouter.use("/auth/sso", ssoPublicRouter);
apiRouter.use("/contact", contactRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/login-history", loginHistoryRouter);
apiRouter.use("/sso", ssoAdminRouter);
apiRouter.use("/data-export", dataExportRouter);
apiRouter.use("/users", usersRouter);
apiRouter.use("/sites", sitesRouter);
apiRouter.use("/roles", rolesRouter);
// Before /documents: a signed file link is its own credential (no bearer header on an <img>/<iframe>), so it must not fall into the authenticated router.
apiRouter.use("/documents/files", documentFilesRouter);
// Document Server fetches the file and posts the save callback with a signed token, not a user session, so that router is mounted first.
apiRouter.use("/onlyoffice", onlyOfficePublicRouter);
// Before the documents-department router: preview needs this from any signed-in page, not only Documents.
apiRouter.use("/onlyoffice", onlyOfficeStatusRouter);
apiRouter.use("/onlyoffice", onlyOfficeRouter);
apiRouter.use("/documents", documentsRouter);
apiRouter.use("/controlled-lists", controlledListsRouter);
apiRouter.use("/document-folders", documentFoldersRouter);
apiRouter.use("/ncr", ncrRouter);
apiRouter.use("/capa", capaRouter);
apiRouter.use("/8d", eightDRouter);
apiRouter.use("/validation-reports", validationReportsRouter);
apiRouter.use("/iso-quality-forms", ecrRouter);
apiRouter.use("/iso-quality-forms", isoQualityFormsRouter);
apiRouter.use("/audits", auditsRouter);
apiRouter.use("/training", trainingRouter);
apiRouter.use("/change", changeRouter);
apiRouter.use("/risk", riskRouter);
apiRouter.use("/ppap", ppapRouter);
apiRouter.use("/quality", qualityRouter);
apiRouter.use("/suppliers", supplierRouter);
apiRouter.use("/equipment", calibrationRouter);
apiRouter.use("/quarantine", quarantineRouter);
apiRouter.use("/complaints", complaintsRouter);
// Before /workflow: approving a run is assigned per approval node, not gated by access to the builder itself.
apiRouter.use("/workflow/runs", workflowRunsRouter);
apiRouter.use("/workflow", workflowRouter);
apiRouter.use("/management-review", managementReviewRouter);
apiRouter.use("/context", contextRouter);
apiRouter.use("/ai", aiRouter);
// Before /digital-twin: device ingest authenticates with X-Device-Key, not a user session,
// and digitalTwinRouter applies requireAuth to everything beneath its prefix.
apiRouter.use("/digital-twin/device-ingest", deviceIngestRouter);
apiRouter.use("/digital-twin", digitalTwinRouter);
apiRouter.use("/audit-trail", auditTrailRouter);
// Self-service router mounted first — it defines only /me and /:id/read, so it never intercepts /retry-failed, but it
// must come before the admin-gated router below or that router's blanket requireRole("admin") would refuse everyone.
apiRouter.use("/notifications", notificationsMeRouter);
apiRouter.use("/notifications", notificationsRouter);
apiRouter.use("/forms", formsRouter);
apiRouter.use("/pdf-exports", pdfExportsRouter);
apiRouter.use("/legal-holds", legalHoldsRouter);
apiRouter.use("/nav", navRouter);
apiRouter.use("/calendar", calendarRouter);
apiRouter.use("/workers", workerRouter);
apiRouter.use("/inventory", inventoryRouter);
// Same precedent as above — /erp/presets/* and /erp/active-preset/* use
// their own admin-only gate (see erpPresets.routes.ts's own comment), not
// erpRouter's requireDepartmentAccess("erp").
apiRouter.use("/erp", erpPresetsRouter);
// Same precedent again — /erp/errors/* (ERP Sync Error Dashboard) is its
// own admin-only gate, not erpRouter's requireDepartmentAccess("erp").
apiRouter.use("/erp", erpSyncErrorsRouter);
apiRouter.use("/erp", erpRouter);
apiRouter.use("/company", companyRouter);
apiRouter.use("/search", searchRouter);
apiRouter.use("/rma", rmaRouter);
apiRouter.use("/work-orders", workOrdersRouter);
apiRouter.use("/feasibility", feasibilityRouter);
// Sales accounts are not part of this app (they live in Oracle NetSuite).
// The sales_* tables stay in place; this router is not mounted.
// Customer onboarding is not part of this app. The customers and
// customer_communications tables stay in place; those routers are not mounted.
apiRouter.use("/document-change-requests", documentChangeRequestsRouter);
apiRouter.use("/qms-forms", qmsFormsRouter);
apiRouter.use("/scar-forms", scarFormsRouter);
apiRouter.use("/quality-inspection-reports", qualityInspectionReportsRouter);
apiRouter.use("/settings", settingsRouter);
apiRouter.use("/attachments", attachmentsRouter);
apiRouter.use("/import", importRouter);
apiRouter.use("/form-import", formImportRouter);
apiRouter.use("/form-builder", formBuilderRouter);
apiRouter.use("/admin/imports", adminImportRouter);
apiRouter.use("/warranty", warrantyRouter);
apiRouter.use("/supplier-portal", supplierPortalRouter);
apiRouter.use("/crar", crarRouter);
apiRouter.use("/rma-activity-log", rmaActivityLogRouter);
apiRouter.use("/rma-log", rmaLogRouter);
apiRouter.use("/permissions", permissionsRouter);
apiRouter.use("/dashboard", dashboardRouter);
apiRouter.use("/fai", faiRouter);
apiRouter.use("/reporting", reportingRouter);
apiRouter.use("/reports", reportsRouter);
apiRouter.use("/system-health", systemHealthRouter);
apiRouter.use("/admin/api-docs", docsRouter);
