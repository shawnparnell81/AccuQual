import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { withSiteContext } from "../sites/siteContext.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import {
  attachExportHandler,
  downloadStoredExportHandler,
  exportStatusHandler,
  fileExportHandler,
  placeLegalHoldHandler,
  releaseLegalHoldHandler,
} from "./pdfExport.controller.js";

export const pdfExportsRouter = Router();
pdfExportsRouter.use(requireAuth, withDb, withSiteContext);
pdfExportsRouter.get("/:exportId", exportStatusHandler);
pdfExportsRouter.get("/:exportId/file", downloadStoredExportHandler);
pdfExportsRouter.post("/:exportId/file", requireDepartmentAccess("documents"), fileExportHandler);
pdfExportsRouter.post("/:exportId/attach", attachExportHandler);

export const legalHoldsRouter = Router();
legalHoldsRouter.use(requireAuth, withDb);
legalHoldsRouter.post("/", placeLegalHoldHandler);
legalHoldsRouter.post("/release", releaseLegalHoldHandler);
