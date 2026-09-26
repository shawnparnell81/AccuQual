import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { withDb } from "../../lib/requestDb.js";
import { validate } from "../../middleware/validate.js";
import { createErpPresetSchema, updateErpPresetSchema } from "./erpPresets.validation.js";
import {
  listPresetsHandler,
  getPresetHandler,
  createPresetHandler,
  clonePresetHandler,
  updatePresetHandler,
  deletePresetHandler,
  activatePresetHandler,
  getActivePresetHandler,
} from "./erpPresets.controller.js";

/**
 * ERP Connector Presets — mirrors ErpSyncSettings' own gate exactly
 * (requireRole("admin"), see settings.routes.ts), not erpRouter's
 * requireDepartmentAccess("erp"): presets configure the same sync engine
 * ErpSyncSettings does, and that's admin-only today. Deliberately its own
 * ResourceKey-free router rather than a new "erp_presets" ResourceKey, so
 * this doesn't need an entry in the two compile-enforced permission maps
 * (departmentAccess.ts's MODULE_LABELS, defaultPermissions.ts's
 * INITIAL_DEFAULT_PERMISSIONS).
 *
 * Mounted at "/erp" but registered before erpRouter in routes/index.ts, same
 * "more specific gate must be tried first" precedent erpRequisitions.routes.ts
 * already established for /erp/requisitions.
 *
 * Every middleware here is applied per-ROUTE, not via a router-level
 * `.use()` — a `.use()` at this router's root runs for EVERY request under
 * "/erp" (including ones this router has no route for at all, e.g.
 * "/erp/purchase-orders"), since Express only skips it after all `.use()`
 * middleware for a mount point has already run. A blanket `.use()` here
 * would both wrongly force admin-only on erpRouter's own department-gated
 * routes AND open a second, never-finalized withDb transaction for
 * every request that falls through to erpRouter — found live via a real
 * regression in erp-module.test.ts's own suite.
 */
export const erpPresetsRouter = Router();
const gate = [requireAuth, withDb, requireRole("admin")];

erpPresetsRouter.get("/active-preset/:module", ...gate, getActivePresetHandler);

erpPresetsRouter.get("/presets", ...gate, listPresetsHandler);
erpPresetsRouter.post("/presets", ...gate, validate(createErpPresetSchema), createPresetHandler);
erpPresetsRouter.get("/presets/:id", ...gate, getPresetHandler);
erpPresetsRouter.put("/presets/:id", ...gate, validate(updateErpPresetSchema), updatePresetHandler);
erpPresetsRouter.delete("/presets/:id", ...gate, deletePresetHandler);
erpPresetsRouter.post("/presets/:id/clone", ...gate, clonePresetHandler);
erpPresetsRouter.post("/presets/:id/activate", ...gate, activatePresetHandler);
