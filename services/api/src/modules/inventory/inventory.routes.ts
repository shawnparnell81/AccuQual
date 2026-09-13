import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createItemSchema, updateItemSchema, movementSchema, adjustSchema, checkMinMaxSchema } from "./inventory.validation.js";
import {
  createItemHandler,
  listItemsHandler,
  getItemHandler,
  updateItemHandler,
  movementHandler,
  adjustHandler,
  markReorderPendingHandler,
  markOnOrderHandler,
  historyHandler,
  listAlertsHandler,
  alertRoutingHandler,
  acknowledgeAlertHandler,
  checkMinMaxHandler,
} from "./inventory.controller.js";
import { movementTrendsHandler, consumptionVsReceivingHandler, scrapAnalyticsHandler, referenceSummaryHandler } from "./inventory.analytics.js";

export const inventoryRouter = Router();
// material_management/purchasing/production get edit; quality gets read-only —
// see departmentAccess.ts PERMISSION_MATRIX. Finer per-action restrictions
// (consume: production-only, adjust: material_management-only, reorder/
// on-order: purchasing-only, deactivate: admin-only) are inline in the
// controller, the same way supplier.controller.ts guards its terminal state.
inventoryRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("inventory"));

// Fixed literal paths ("/alerts", "/check-minmax") before ":id"-shaped ones,
// same convention workflow.routes.ts uses for "/history/...".
inventoryRouter.get("/alerts", listAlertsHandler);
inventoryRouter.get("/alerts/routing", alertRoutingHandler);
inventoryRouter.post("/alerts/:id/acknowledge", acknowledgeAlertHandler);
inventoryRouter.post("/check-minmax", validate(checkMinMaxSchema), checkMinMaxHandler);

inventoryRouter.get("/analytics/movements", movementTrendsHandler);
inventoryRouter.get("/analytics/consumption-vs-receiving", consumptionVsReceivingHandler);
inventoryRouter.get("/analytics/scrap", scrapAnalyticsHandler);
inventoryRouter.get("/analytics/reference-summary", referenceSummaryHandler);

inventoryRouter.get("/items", listItemsHandler);
inventoryRouter.post("/items", validate(createItemSchema), createItemHandler);
inventoryRouter.get("/items/:id", getItemHandler);
inventoryRouter.patch("/items/:id", validate(updateItemSchema), updateItemHandler);
inventoryRouter.post("/items/:id/movement", validate(movementSchema), movementHandler);
inventoryRouter.post("/items/:id/adjust", validate(adjustSchema), adjustHandler);
inventoryRouter.post("/items/:id/mark-reorder-pending", markReorderPendingHandler);
inventoryRouter.post("/items/:id/mark-on-order", markOnOrderHandler);
inventoryRouter.get("/items/:id/history", historyHandler);
