import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import {
  checkImportHandler,
  downloadErrors,
  getImport,
  listImportTypes,
  listImports,
  requireImportPermission,
  runImportHandler,
  templateHandler,
  uploadImport,
  uploadImportFile,
} from "./adminImport.controller.js";

/** Admin bulk import. Files are stored on disk and read in chunks; the request does not keep a database transaction open. */
export const adminImportRouter = Router();
adminImportRouter.use(requireAuth, requireImportPermission);

adminImportRouter.get("/types", listImportTypes);
adminImportRouter.get("/types/:key/template", templateHandler);
adminImportRouter.get("/", listImports);
adminImportRouter.post("/", uploadImportFile, uploadImport);
adminImportRouter.get("/:id/errors", downloadErrors);
adminImportRouter.get("/:id", getImport);
adminImportRouter.post("/:id/check", checkImportHandler);
adminImportRouter.post("/:id/run", runImportHandler);
