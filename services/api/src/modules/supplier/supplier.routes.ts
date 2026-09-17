import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createSupplierSchema, addScorecardSchema, createPortalAccountSchema } from "./supplier.validation.js";
import {
  baseHandlers,
  addScorecardHandler,
  approveHandler,
  conditionalHandler,
  suspendHandler,
  removeHandler,
  createPortalAccountHandler,
  getSupplierRiskScoreHandler,
  recomputeSupplierRiskScoreHandler,
  getSupplierKpisHandler,
  exportSupplierScorecardHandler,
} from "./supplier.controller.js";
import { getSupplierPerformanceHandler, performanceSummaryHandler } from "./supplier.performance.js";

export const supplierRouter = Router();
// Suppliers is shared by 4 departments at different levels (Quality: edit,
// Purchasing/Material Mgmt/Production: read-only) — see departmentAccess.ts.
// Note this means the 4 dedicated actions below are Quality/admin-only
// today — real Purchasing users only have read access, unlike the brief's
// assumption that Purchasing could approve a supplier (see the Permissions
// Dictionary). Production was added purely for the read-only Performance
// Analytics endpoints below (see the Supplier Performance Analytics review)
// — it has no write access to anything here.
supplierRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("suppliers"));

// Fixed literal path before ":id"-shaped ones, same convention used
// throughout this app (workflow.routes.ts's "/history/...", etc.).
supplierRouter.get("/performance-summary", performanceSummaryHandler);

supplierRouter.get("/", baseHandlers.list);
supplierRouter.post("/", validate(createSupplierSchema), baseHandlers.create);
supplierRouter.get("/:id", baseHandlers.getOne);
supplierRouter.get("/:id/performance", getSupplierPerformanceHandler);
supplierRouter.post("/:id/scorecard", validate(addScorecardSchema), addScorecardHandler);
// Phase 7 — Supplier Quality Risk Score / KPIs / scorecard export. GET is
// read-level (Purchasing/Material Mgmt/Production too, same as
// /performance above); POST /risk-score/recompute needs edit level, which
// only Quality/admin get from requireDepartmentAccess("suppliers")'s own
// read/write distinction — no extra guard needed here.
supplierRouter.get("/:id/risk-score", getSupplierRiskScoreHandler);
supplierRouter.post("/:id/risk-score/recompute", recomputeSupplierRiskScoreHandler);
supplierRouter.get("/:id/kpis", getSupplierKpisHandler);
supplierRouter.get("/:id/scorecard/export", exportSupplierScorecardHandler);
supplierRouter.post("/:id/approve", approveHandler);
supplierRouter.post("/:id/conditional", conditionalHandler);
supplierRouter.post("/:id/suspend", suspendHandler);
supplierRouter.post("/:id/remove", removeHandler);
// Creates the Supplier Portal's external login for this supplier — see
// createPortalAccountHandler's own comment. Quality/admin only, same level
// as approve/conditional/suspend/remove above.
supplierRouter.post("/:id/portal-account", validate(createPortalAccountSchema), createPortalAccountHandler);
