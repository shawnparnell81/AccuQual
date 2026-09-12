import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { createDocumentFolderSchema, updateDocumentFolderSchema } from "./document-folders.validation.js";
import { list, create, update, remove, uploadTemplate, downloadTemplate, removeTemplate } from "./document-folders.controller.js";

export const documentFoldersRouter = Router();
documentFoldersRouter.use(requireAuth, withTenantDb);

// memoryStorage: files are small (PDF forms), and uploadTemplate decides the
// on-disk path itself (needs the folder id, which multer parses before the
// handler runs) — simpler than a disk-storage destination callback.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

documentFoldersRouter.get("/", list);
documentFoldersRouter.post("/", validate(createDocumentFolderSchema), create);
documentFoldersRouter.patch("/:id", validate(updateDocumentFolderSchema), update);
documentFoldersRouter.delete("/:id", remove);

documentFoldersRouter.post("/:id/template", upload.single("file"), uploadTemplate);
documentFoldersRouter.get("/:id/template", downloadTemplate);
documentFoldersRouter.delete("/:id/template", removeTemplate);
