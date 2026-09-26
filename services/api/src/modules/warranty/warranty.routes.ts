import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createWarrantyClaimSchema, updateWarrantyClaimSchema, transitionWarrantyClaimSchema, createWarrantyCostSchema } from "./warranty.validation.js";
import {
  listWarrantyClaimsHandler,
  createWarrantyClaimHandler,
  getWarrantyClaimHandler,
  updateWarrantyClaimHandler,
  transitionWarrantyClaimHandler,
  uploadWarrantyDocumentHandler,
  listWarrantyCostsHandler,
  createWarrantyCostHandler,
  warrantyAnalyticsHandler,
} from "./warranty.controller.js";

export const warrantyRouter = Router();
// customer_service/quality/engineering get edit, purchasing/material_management
// read-only — see departmentAccess.ts PERMISSION_MATRIX.warranty. Finer
// per-action restrictions (create: customer_service+quality only; each
// status transition gated to its own department set) are inline in
// warranty.controller.ts, same pattern as rma.controller.ts.
warrantyRouter.use(requireAuth, withDb, requireDepartmentAccess("warranty"));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Fixed literal path before "/claims/:id"-shaped ones.
warrantyRouter.get("/analytics", warrantyAnalyticsHandler);

warrantyRouter.get("/claims", listWarrantyClaimsHandler);
warrantyRouter.post("/claims", validate(createWarrantyClaimSchema), createWarrantyClaimHandler);
warrantyRouter.get("/claims/:id", getWarrantyClaimHandler);
warrantyRouter.post("/claims/:id/update", validate(updateWarrantyClaimSchema), updateWarrantyClaimHandler);
warrantyRouter.post("/claims/:id/upload", upload.single("file"), uploadWarrantyDocumentHandler);
warrantyRouter.post("/claims/:id/transition", validate(transitionWarrantyClaimSchema), transitionWarrantyClaimHandler);

warrantyRouter.get("/claims/:id/costs", listWarrantyCostsHandler);
warrantyRouter.post("/claims/:id/costs", validate(createWarrantyCostSchema), createWarrantyCostHandler);
