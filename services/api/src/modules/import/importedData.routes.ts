import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { withSiteContext } from "../sites/siteContext.js";
import { requireImportPermission } from "./adminImport.controller.js";
import { deleteImportedData, downloadImportedFile, getImportedData, listImportedData, restoreImportedData } from "./importedData.controller.js";

export const importedDataRouter = Router();
importedDataRouter.use(requireAuth, withDb, withSiteContext, requireImportPermission);
importedDataRouter.get("/", listImportedData);
importedDataRouter.get("/:id/file", downloadImportedFile);
importedDataRouter.get("/:id", getImportedData);
importedDataRouter.post("/:id/delete", deleteImportedData);
importedDataRouter.post("/:id/restore", restoreImportedData);
