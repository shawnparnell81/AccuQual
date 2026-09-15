import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { createQualityInspectionReportSchema, updateQualityInspectionReportSchema, createInspectionItemSchema, updateInspectionItemSchema } from "./qualityInspectionReports.validation.js";
import {
  listReportsHandler,
  createReportHandler,
  getReportHandler,
  updateReportHandler,
  deleteReportHandler,
  createItemHandler,
  updateItemHandler,
  deleteItemHandler,
} from "./qualityInspectionReports.controller.js";

export const qualityInspectionReportsRouter = Router();
// Deliberately not gated — same convention as the rest of this batch.
qualityInspectionReportsRouter.use(requireAuth, withTenantDb);

qualityInspectionReportsRouter.get("/", listReportsHandler);
qualityInspectionReportsRouter.post("/", validate(createQualityInspectionReportSchema), createReportHandler);
qualityInspectionReportsRouter.get("/:id", getReportHandler);
qualityInspectionReportsRouter.patch("/:id", validate(updateQualityInspectionReportSchema), updateReportHandler);
qualityInspectionReportsRouter.delete("/:id", deleteReportHandler);

qualityInspectionReportsRouter.post("/:id/items", validate(createInspectionItemSchema), createItemHandler);
qualityInspectionReportsRouter.patch("/:id/items/:itemId", validate(updateInspectionItemSchema), updateItemHandler);
qualityInspectionReportsRouter.delete("/:id/items/:itemId", deleteItemHandler);
