import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { withDb } from "../../lib/requestDb.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createReportScheduleSchema, updateReportScheduleSchema, reportSummarySchema } from "./reporting.validation.js";
import {
  ncrMetricsHandler,
  capaMetricsHandler,
  supplierPerformanceReportHandler,
  warrantyTrendsHandler,
  receivingTrendsHandler,
  inventoryQualityTrendsHandler,
  workflowCycleTimeHandler,
  reportSummaryHandler,
  listReportSchedulesHandler,
  createReportScheduleHandler,
  updateReportScheduleHandler,
  deleteReportScheduleHandler,
  sendReportScheduleNowHandler,
  exportReportHandler,
} from "./reporting.controller.js";

/**
 * Phase 6 Reporting & Analytics Hub — RBAC deliberately reuses each report's
 * own underlying module's existing ResourceKey (requireDepartmentAccess),
 * never a new parallel "reporting" permission a company admin would have to
 * remember to configure separately. This is what the phase's own task 5
 * ("Quality roles see quality reports, Supplier roles see supplier
 * reports...") means in practice: whatever access level a user already has
 * to NCR data is exactly the access level they get to the NCR report — one
 * source of truth, no risk of the two drifting apart (see Phase 3's
 * findings on "declared but never enforced" permissions for why a second,
 * parallel key is a real risk, not a hypothetical one). admin
 * bypass every one of these the same way they bypass the underlying module.
 *
 * Receiving inspection trends and Inventory quality trends both read from
 * physical-goods-movement data with no closer existing ResourceKey than
 * "inventory" (quality_inspection_reports itself has no department gate at
 * all today — see that module's own routes file) — gating the new report
 * endpoint here is a deliberate improvement over the ungated source data,
 * not a gap this phase introduced.
 */
export const reportingRouter = Router();
reportingRouter.use(requireAuth, withDb);

reportingRouter.get("/ncr-metrics", requireDepartmentAccess("ncr"), ncrMetricsHandler);
reportingRouter.get("/capa-metrics", requireDepartmentAccess("capa"), capaMetricsHandler);
reportingRouter.get("/supplier-performance", requireDepartmentAccess("suppliers"), supplierPerformanceReportHandler);
reportingRouter.get("/warranty-trends", requireDepartmentAccess("warranty"), warrantyTrendsHandler);
reportingRouter.get("/receiving-trends", requireDepartmentAccess("inventory"), receivingTrendsHandler);
reportingRouter.get("/inventory-quality-trends", requireDepartmentAccess("inventory"), inventoryQualityTrendsHandler);
reportingRouter.get("/workflow-cycle-time", requireDepartmentAccess("ncr"), workflowCycleTimeHandler);

// Export — one explicit route per report key so each keeps the exact same
// RBAC gate as its own metrics endpoint above, rather than a single dynamic
// dispatcher route whose gate would have to guess the right ResourceKey at
// runtime. :reportKey is a real route param (not a query string) so
// exportReportHandler's own req.params.reportKey lookup works unchanged
// for all 5 — this is just "one literal path per gate", not one wildcard.
reportingRouter.get("/export/:reportKey(ncr-metrics)", requireDepartmentAccess("ncr"), exportReportHandler);
reportingRouter.get("/export/:reportKey(capa-metrics)", requireDepartmentAccess("capa"), exportReportHandler);
reportingRouter.get("/export/:reportKey(supplier-performance)", requireDepartmentAccess("suppliers"), exportReportHandler);
reportingRouter.get("/export/:reportKey(warranty-trends)", requireDepartmentAccess("warranty"), exportReportHandler);
reportingRouter.get("/export/:reportKey(receiving-trends)", requireDepartmentAccess("inventory"), exportReportHandler);
reportingRouter.get("/export/:reportKey(inventory-quality-trends)", requireDepartmentAccess("inventory"), exportReportHandler);

// AI-assisted summaries — no separate department gate beyond requireAuth,
// same "must work for any authenticated user" convention every /ai/*
// endpoint already uses (see ai.routes.ts's own comment); the real
// sensitive data underneath was already gated when it was fetched to
// build `input`, not re-gated here.
reportingRouter.post("/summary", validate(reportSummarySchema), reportSummaryHandler);

/**
 * Scheduled reports are admin-only (not the per-report ResourceKeys above):
 * a schedule's `recipients` list is an arbitrary set of email addresses the
 * creator chooses — sending a company's own real quality/supplier/warranty
 * numbers to any inbox on a recurring basis is a materially different,
 * more sensitive action than just viewing the dashboard, and this app's own
 * established convention for "configures a recurring/external-facing
 * thing" (Settings → ERP Sync, company AI config, notification retry) is
 * already admin-only throughout.
 */
reportingRouter.get("/schedules", requireRole("admin"), listReportSchedulesHandler);
reportingRouter.post("/schedules", requireRole("admin"), validate(createReportScheduleSchema), createReportScheduleHandler);
reportingRouter.patch("/schedules/:id", requireRole("admin"), validate(updateReportScheduleSchema), updateReportScheduleHandler);
reportingRouter.delete("/schedules/:id", requireRole("admin"), deleteReportScheduleHandler);
reportingRouter.post("/schedules/:id/send-now", requireRole("admin"), sendReportScheduleNowHandler);
