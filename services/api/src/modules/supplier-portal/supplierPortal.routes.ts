import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { requireSupplierPortalAccess } from "../../middleware/departmentAccess.js";
import {
  reviewOnboardingDocumentSchema,
  submitPpapSchema,
  reviewPpapSchema,
  submitCorrectiveActionSchema,
  reviewResponseSchema,
  submit8dSchema,
  sendMessageSchema,
  sendMessageEmailSchema,
  updateSupplierSettingsSchema,
} from "./supplierPortal.validation.js";
import { submitRmaRequestSchema } from "./rmaRequest.validation.js";
import { submitRmaRequestHandler, rmaRequestStatusHandler } from "./rmaRequest.controller.js";
import {
  uploadOnboardingDocumentHandler,
  onboardingStatusHandler,
  reviewOnboardingDocumentHandler,
  uploadSupplierDocumentHandler,
  listSupplierDocumentsHandler,
  submitPpapHandler,
  uploadPpapDocumentHandler,
  ppapStatusHandler,
  reviewPpapHandler,
  respondCorrectiveActionHandler,
  listCorrectiveActionsHandler,
  reviewCorrectiveActionHandler,
  submit8dHandler,
  eightDStatusHandler,
  review8dHandler,
  sendMessageHandler,
  sendMessageEmailHandler,
  getThreadHandler,
  scorecardHandler,
  performanceHandler,
  supplierNcrListHandler,
  supplierCapaListHandler,
  supplierRmaListHandler,
  supplierWarrantyListHandler,
  supplierScarListHandler,
  supplierKpisHandler,
  supplierRiskScoreHandler,
  supplierScorecardExportHandler,
  supplierInspectionListHandler,
  supplierLotListHandler,
  getSupplierSettingsHandler,
  updateSupplierSettingsHandler,
} from "./supplierPortal.controller.js";

export const supplierPortalRouter = Router();
// Two real audiences share this router — an external supplier login
// (roleName:"supplier", auto-scoped to their own supplierId) and internal
// staff (Quality/Purchasing edit, Engineering read, per
// PERMISSION_MATRIX.supplier_portal) — see requireSupplierPortalAccess's
// own comment. Every handler resolves which supplier it's allowed to touch
// itself (resolveSupplierScope/resolveSupplierFilter in the controller),
// never trusting a client-supplied supplierId from a supplier account.
supplierPortalRouter.use(requireAuth, withTenantDb, requireSupplierPortalAccess);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Onboarding
supplierPortalRouter.post("/onboarding/upload", upload.single("file"), uploadOnboardingDocumentHandler);
supplierPortalRouter.get("/onboarding/status", onboardingStatusHandler);
supplierPortalRouter.post("/onboarding/:id/review", validate(reviewOnboardingDocumentSchema), reviewOnboardingDocumentHandler);

// Ongoing document management
supplierPortalRouter.post("/documents/upload", upload.single("file"), uploadSupplierDocumentHandler);
supplierPortalRouter.get("/documents/list", listSupplierDocumentsHandler);

// PPAP (Levels 1-5)
supplierPortalRouter.post("/ppap/submit", validate(submitPpapSchema), submitPpapHandler);
supplierPortalRouter.post("/ppap/:id/documents", upload.single("file"), uploadPpapDocumentHandler);
supplierPortalRouter.get("/ppap/status", ppapStatusHandler);
supplierPortalRouter.post("/ppap/:id/review", validate(reviewPpapSchema), reviewPpapHandler);

// Corrective Action responses
supplierPortalRouter.post("/corrective-actions/respond", validate(submitCorrectiveActionSchema), respondCorrectiveActionHandler);
supplierPortalRouter.get("/corrective-actions/list", listCorrectiveActionsHandler);
supplierPortalRouter.post("/corrective-actions/:id/review", validate(reviewResponseSchema), reviewCorrectiveActionHandler);

// Full 8D responses
supplierPortalRouter.post("/8d/submit", validate(submit8dSchema), submit8dHandler);
supplierPortalRouter.get("/8d/status", eightDStatusHandler);
supplierPortalRouter.post("/8d/:id/review", validate(reviewResponseSchema), review8dHandler);

// Messaging
supplierPortalRouter.post("/messages/send", validate(sendMessageSchema), sendMessageHandler);
supplierPortalRouter.post("/messages/send-email", validate(sendMessageEmailSchema), sendMessageEmailHandler);
supplierPortalRouter.get("/messages/thread", getThreadHandler);

// Scorecard + performance
supplierPortalRouter.get("/scorecard", scorecardHandler);
supplierPortalRouter.get("/performance", performanceHandler);

// NCR/CAPA visibility (read-only, derived — see the controller's own comment)
supplierPortalRouter.get("/ncr/list", supplierNcrListHandler);
supplierPortalRouter.get("/capa/list", supplierCapaListHandler);

// Phase 7 — RMA/Warranty/SCAR visibility (real supplierId FK on each — see
// the controller's own comment on why these still need a wrapper endpoint
// rather than reusing /rma, /warranty, /scar-forms directly), KPIs/health,
// and the read-only Quality Risk Score + scorecard export.
supplierPortalRouter.get("/rma/list", supplierRmaListHandler);
supplierPortalRouter.get("/warranty/list", supplierWarrantyListHandler);
supplierPortalRouter.get("/scar/list", supplierScarListHandler);
supplierPortalRouter.get("/kpis", supplierKpisHandler);
supplierPortalRouter.get("/risk-score", supplierRiskScoreHandler);
supplierPortalRouter.get("/scorecard/export", supplierScorecardExportHandler);

// Phase 8 — inspection reports (real supplierId FK) + lots (accepted/rejected shipments) visibility.
supplierPortalRouter.get("/inspections/list", supplierInspectionListHandler);
supplierPortalRouter.get("/lots/list", supplierLotListHandler);

// Settings
supplierPortalRouter.get("/settings", getSupplierSettingsHandler);
supplierPortalRouter.post("/settings", validate(updateSupplierSettingsSchema), updateSupplierSettingsHandler);

// RMA Request — supplier-only (see rmaRequest.controller.ts's own checks);
// internal staff reach the resulting real RMA through the existing RMA
// module and the new /rma-log feed instead of through this path.
supplierPortalRouter.post("/rma-request", validate(submitRmaRequestSchema), submitRmaRequestHandler);
supplierPortalRouter.get("/rma-request/status", rmaRequestStatusHandler);
