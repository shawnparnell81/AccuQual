import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { withSiteContext } from "../sites/siteContext.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createReceivingDocumentSchema, transitionReceivingLineItemSchema } from "./erp.validation.js";
import {
  listReceivingDocumentsHandler,
  createReceivingDocumentHandler,
  getReceivingDocumentHandler,
  transitionReceivingLineItemHandler,
  createReceivingNcrHandler,
} from "./erp.controller.js";

export const erpRouter = Router();
// Purchase orders and requisitions are no longer part of this app.
// Receiving stays, because incoming inspection still uses it.
erpRouter.use(requireAuth, withDb, withSiteContext, requireDepartmentAccess("erp"));

erpRouter.get("/receiving-documents", listReceivingDocumentsHandler);
erpRouter.post("/receiving-documents", validate(createReceivingDocumentSchema), createReceivingDocumentHandler);
erpRouter.get("/receiving-documents/:id", getReceivingDocumentHandler);
// the receiving line item state machine's one write path; RBAC
// varies by target status, enforced inside transitionReceivingLineItem
// itself (see that file's own comment), not by this router's fixed gate.
erpRouter.post("/receiving-line-items/:id/status", validate(transitionReceivingLineItemSchema), transitionReceivingLineItemHandler);
erpRouter.post("/receiving-line-items/:id/ncr", createReceivingNcrHandler);
