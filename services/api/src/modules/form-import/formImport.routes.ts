import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { executeFormImport, inspectFormImport, listFormImportTemplates, previewFormImport, uploadImportFile } from "./formImport.controller.js";

/** Filled-spreadsheet import into existing form templates. Same documents permission as those saves. */
export const formImportRouter = Router();
formImportRouter.use(requireAuth, withDb);

formImportRouter.get("/templates", listFormImportTemplates);
formImportRouter.post("/inspect", uploadImportFile, inspectFormImport);
formImportRouter.post("/preview", previewFormImport);
formImportRouter.post("/execute", executeFormImport);
