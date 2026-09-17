import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createItemSchema, updateItemSchema, movementSchema, adjustSchema, checkMinMaxSchema, reorderRequestNotesSchema, reserveSchema, releaseSchema, cycleCountSchema } from "./inventory.validation.js";
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
  listReorderRequestsHandler,
  sendReorderRequestHandler,
  ignoreReorderRequestHandler,
  notesReorderRequestHandler,
  reserveHandler,
  releaseHandler,
  recordCycleCountHandler,
  listItemLotsHandler,
  traceLotHandler,
} from "./inventory.controller.js";
import { movementTrendsHandler, consumptionVsReceivingHandler, scrapAnalyticsHandler, referenceSummaryHandler } from "./inventory.analytics.js";
import { getItemCostingHandler, costingSummaryHandler } from "./inventory.costing.js";

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

// "/costing/summary" fixed literal path before "/costing/:itemId".
inventoryRouter.get("/costing/summary", costingSummaryHandler);
inventoryRouter.get("/costing/:itemId", getItemCostingHandler);

inventoryRouter.get("/reorder-requests", listReorderRequestsHandler);
inventoryRouter.post("/reorder-requests/:id/send", sendReorderRequestHandler);
inventoryRouter.post("/reorder-requests/:id/ignore", ignoreReorderRequestHandler);
inventoryRouter.post("/reorder-requests/:id/notes", validate(reorderRequestNotesSchema), notesReorderRequestHandler);

inventoryRouter.get("/items", listItemsHandler);
inventoryRouter.post("/items", validate(createItemSchema), createItemHandler);
inventoryRouter.get("/items/:id", getItemHandler);
inventoryRouter.patch("/items/:id", validate(updateItemSchema), updateItemHandler);
inventoryRouter.post("/items/:id/movement", validate(movementSchema), movementHandler);
inventoryRouter.post("/items/:id/adjust", validate(adjustSchema), adjustHandler);
inventoryRouter.post("/items/:id/mark-reorder-pending", markReorderPendingHandler);
inventoryRouter.post("/items/:id/mark-on-order", markOnOrderHandler);
inventoryRouter.get("/items/:id/history", historyHandler);
// Phase 8 — real per-lot/serial traceability (task 4).
inventoryRouter.get("/items/:id/lots", listItemLotsHandler);
inventoryRouter.get("/lots/:id/trace", traceLotHandler);
// Settings → Inventory Module expansion (reservation logic + cycle counts) —
// same base "inventory" edit-level gate as movement/adjust above.
inventoryRouter.post("/items/:id/reserve", validate(reserveSchema), reserveHandler);
inventoryRouter.post("/items/:id/release", validate(releaseSchema), releaseHandler);
inventoryRouter.post("/items/:id/count", validate(cycleCountSchema), recordCycleCountHandler);
