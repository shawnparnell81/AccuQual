import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createPurchaseOrderSchema, updatePurchaseOrderSchema, replaceLineItemsSchema, createReceivingDocumentSchema } from "./erp.validation.js";
import {
  listPurchaseOrdersHandler,
  createPurchaseOrderHandler,
  getPurchaseOrderHandler,
  updatePurchaseOrderHandler,
  replaceLineItemsHandler,
  sendPurchaseOrderHandler,
  cancelPurchaseOrderHandler,
  listReceivingDocumentsHandler,
  createReceivingDocumentHandler,
  getReceivingDocumentHandler,
  erpOverviewHandler,
} from "./erp.controller.js";

export const erpRouter = Router();
// purchasing/material_management get edit; quality gets read-only — see
// departmentAccess.ts PERMISSION_MATRIX. Finer per-action restrictions
// (send/cancel/edit-line-items: purchasing-only, create receiving
// document: material_management-only) are inline in the controller, the
// same way inventory.controller.ts guards its per-action limits.
erpRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("erp"));

// Fixed literal path before ":id"-shaped ones, same convention used
// throughout this app.
erpRouter.get("/overview", erpOverviewHandler);

erpRouter.get("/purchase-orders", listPurchaseOrdersHandler);
erpRouter.post("/purchase-orders", validate(createPurchaseOrderSchema), createPurchaseOrderHandler);
erpRouter.get("/purchase-orders/:id", getPurchaseOrderHandler);
erpRouter.patch("/purchase-orders/:id", validate(updatePurchaseOrderSchema), updatePurchaseOrderHandler);
erpRouter.put("/purchase-orders/:id/line-items", validate(replaceLineItemsSchema), replaceLineItemsHandler);
erpRouter.post("/purchase-orders/:id/send", sendPurchaseOrderHandler);
erpRouter.post("/purchase-orders/:id/cancel", cancelPurchaseOrderHandler);

erpRouter.get("/receiving-documents", listReceivingDocumentsHandler);
erpRouter.post("/receiving-documents", validate(createReceivingDocumentSchema), createReceivingDocumentHandler);
erpRouter.get("/receiving-documents/:id", getReceivingDocumentHandler);
