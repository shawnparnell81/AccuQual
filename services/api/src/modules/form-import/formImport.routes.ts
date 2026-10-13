import { Router } from "express";
import { scanUploads } from "../upload-scan/uploadScan.js";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import {
  aiSuggestHandler,
  confirmImportHandler,
  confirmUploadFile,
  deleteMappingHandler,
  executeFormImport,
  extractFileHandler,
  inspectFormImport,
  listFormImportTemplates,
  listImportTargetsHandler,
  listMappingsHandler,
  previewFormImport,
  proposeValuesHandler,
  saveMappingHandler,
  updateMappingHandler,
  uploadImportFile,
} from "./formImport.controller.js";

/** Filled-spreadsheet import into existing form templates. Same documents permission as those saves. */
export const formImportRouter = Router();
formImportRouter.use(requireAuth, withDb);

formImportRouter.get("/templates", listFormImportTemplates);
formImportRouter.post("/inspect", uploadImportFile, scanUploads("Import from file"), inspectFormImport);
formImportRouter.post("/preview", previewFormImport);
formImportRouter.post("/execute", executeFormImport);

/** Generic "Import from file" (Word/Excel/CSV). Extract and propose write nothing; only confirm saves. */
formImportRouter.get("/targets", listImportTargetsHandler);
formImportRouter.post("/extract", uploadImportFile, scanUploads("Import from file"), extractFileHandler);
formImportRouter.post("/propose", proposeValuesHandler);
formImportRouter.post("/confirm", confirmUploadFile, scanUploads("Import from file"), confirmImportHandler);
formImportRouter.post("/ai-suggest", aiSuggestHandler);

/** Saved per-target mappings (Phase 2). Each one checks the target's own permission. */
formImportRouter.get("/mappings", listMappingsHandler);
formImportRouter.post("/mappings", saveMappingHandler);
formImportRouter.patch("/mappings/:id", updateMappingHandler);
formImportRouter.delete("/mappings/:id", deleteMappingHandler);
