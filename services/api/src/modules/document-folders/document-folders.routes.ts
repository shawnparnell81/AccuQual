import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { createDocumentFolderSchema, updateDocumentFolderSchema } from "./document-folders.validation.js";
import { list, create, update, remove } from "./document-folders.controller.js";

export const documentFoldersRouter = Router();
documentFoldersRouter.use(requireAuth, withTenantDb);

documentFoldersRouter.get("/", list);
documentFoldersRouter.post("/", validate(createDocumentFolderSchema), create);
documentFoldersRouter.patch("/:id", validate(updateDocumentFolderSchema), update);
documentFoldersRouter.delete("/:id", remove);
