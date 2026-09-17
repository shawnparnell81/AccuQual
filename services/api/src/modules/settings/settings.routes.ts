import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { requireAnyDepartment } from "../../middleware/departmentAccess.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { updateFeasibilitySettingsSchema, updateInventorySettingsSchema, updateErpSyncSettingsSchema, updateSupplierRiskSettingsSchema, updateReceivingSettingsSchema } from "./settings.validation.js";
import {
  getFeasibilitySettingsHandler,
  updateFeasibilitySettingsHandler,
  getInventorySettingsHandler,
  updateInventorySettingsHandler,
  getErpSyncSettingsHandler,
  updateErpSyncSettingsHandler,
  triggerErpSyncHandler,
  getSupplierRiskSettingsHandler,
  updateSupplierRiskSettingsHandler,
  getReceivingSettingsHandler,
  updateReceivingSettingsHandler,
} from "./settings.controller.js";

/**
 * Tenant-wide configuration for three modules (Feasibility/Inventory/ERP
 * Sync) — see tenants.ts's own schema comments for why this lives as jsonb
 * on the tenants row rather than a separate tenant_settings table (same
 * "rarely-changed config a human edits" precedent as branding/aiConfig,
 * see modules/tenant/tenant.controller.ts). GET is open to any department
 * with real access to that module's records (so e.g. a Quality user can see
 * why a feasibility review defaulted to a given risk level); PATCH is
 * narrower — see each route's own RBAC below, matching the "4./5./6." spec's
 * explicit department lists exactly (Feasibility: Quality+Engineering;
 * Inventory: Production+Purchasing; ERP Sync: Admin only).
 */
export const settingsRouter = Router();
settingsRouter.use(requireAuth, withTenantDb);

settingsRouter.get("/feasibility", getFeasibilitySettingsHandler);
settingsRouter.post("/feasibility", requireAnyDepartment("quality", "engineering"), validate(updateFeasibilitySettingsSchema), updateFeasibilitySettingsHandler);

settingsRouter.get("/inventory", getInventorySettingsHandler);
settingsRouter.post("/inventory", requireAnyDepartment("production", "purchasing"), validate(updateInventorySettingsSchema), updateInventorySettingsHandler);

settingsRouter.get("/erp-sync", requireRole("admin"), getErpSyncSettingsHandler);
settingsRouter.post("/erp-sync", requireRole("admin"), validate(updateErpSyncSettingsSchema), updateErpSyncSettingsHandler);
settingsRouter.post("/erp-sync/trigger", requireRole("admin"), triggerErpSyncHandler);

// Phase 7 — Supplier Risk formula weights. PATCH-equivalent restricted to
// Quality (the "suppliers" ResourceKey's own edit-level department, same as
// every dedicated supplier action in supplier.routes.ts); GET open to
// anyone who can see supplier records at all (Quality/Purchasing/Material
// Mgmt/Production), same "why did this score come out this way" reasoning
// as Feasibility's own GET above.
settingsRouter.get("/supplier-risk", getSupplierRiskSettingsHandler);
settingsRouter.post("/supplier-risk", requireAnyDepartment("quality"), validate(updateSupplierRiskSettingsSchema), updateSupplierRiskSettingsHandler);

// Phase 8 — Receiving auto-trigger/escalation config. Same Quality-only
// PATCH / open GET split as Supplier Risk above (Quality owns receiving
// inspection dispositions, the thing these settings actually govern).
settingsRouter.get("/receiving", getReceivingSettingsHandler);
settingsRouter.post("/receiving", requireAnyDepartment("quality"), validate(updateReceivingSettingsSchema), updateReceivingSettingsHandler);
