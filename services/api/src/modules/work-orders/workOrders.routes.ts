import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import {
  createWorkOrderSchema,
  updateWorkOrderSchema,
  completeWorkOrderSchema,
  updateQualityGatesSchema,
  signTravelerSchema,
  createOperationSchema,
  reorderOperationsSchema,
  updateOperationSchema,
} from "./workOrders.validation.js";
import {
  listWorkOrdersHandler,
  createWorkOrderHandler,
  getWorkOrderHandler,
  updateWorkOrderHandler,
  startWorkOrderHandler,
  completeWorkOrderHandler,
  cancelWorkOrderHandler,
  updateQualityGatesHandler,
  signOperatorHandler,
  signInspectorHandler,
  createOperationHandler,
  reorderOperationsHandler,
  updateOperationHandler,
  deleteOperationHandler,
} from "./workOrders.controller.js";
import { workOrderAiPlanHandler } from "./workOrder.ai.js";

export const workOrdersRouter = Router();
// Customer Service gets edit; production/material_management/purchasing/
// quality get read — see departmentAccess.ts PERMISSION_MATRIX.work_orders.
// Per-action limits (only Customer Service may create/start/complete/
// cancel) are inline in workOrders.controller.ts, the same assertDepartment
// pattern every other module in this app uses. Admin/platform_admin
// ("General Manager", for now) bypass this entirely.
workOrdersRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("work_orders"));

// Fixed literal path before ":id"-shaped ones, same convention used
// throughout this app.
workOrdersRouter.post("/ai-plan", workOrderAiPlanHandler);

workOrdersRouter.get("/", listWorkOrdersHandler);
workOrdersRouter.post("/", validate(createWorkOrderSchema), createWorkOrderHandler);
workOrdersRouter.get("/:id", getWorkOrderHandler);
workOrdersRouter.patch("/:id", validate(updateWorkOrderSchema), updateWorkOrderHandler);
workOrdersRouter.post("/:id/start", startWorkOrderHandler);
workOrdersRouter.post("/:id/complete", validate(completeWorkOrderSchema), completeWorkOrderHandler);
workOrdersRouter.post("/:id/cancel", cancelWorkOrderHandler);

// Production Work Order traveler (bespoke standalone page — see workOrders.ts's schema comment).
workOrdersRouter.patch("/:id/quality-gates", validate(updateQualityGatesSchema), updateQualityGatesHandler);
workOrdersRouter.post("/:id/sign-operator", validate(signTravelerSchema), signOperatorHandler);
workOrdersRouter.post("/:id/sign-inspector", validate(signTravelerSchema), signInspectorHandler);
workOrdersRouter.post("/:id/operations", validate(createOperationSchema), createOperationHandler);
workOrdersRouter.post("/:id/operations/reorder", validate(reorderOperationsSchema), reorderOperationsHandler);
workOrdersRouter.patch("/:id/operations/:opId", validate(updateOperationSchema), updateOperationHandler);
workOrdersRouter.delete("/:id/operations/:opId", deleteOperationHandler);
