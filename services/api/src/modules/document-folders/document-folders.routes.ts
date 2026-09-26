import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { validate } from "../../middleware/validate.js";
import { createDocumentFolderSchema, updateDocumentFolderSchema } from "./document-folders.validation.js";
import { list, create, update, remove, uploadTemplate, uploadDocument, downloadTemplate, removeTemplate } from "./document-folders.controller.js";

export const documentFoldersRouter = Router();
// Security audit finding (high): this router had no RBAC gate at all — any
// authenticated company user could create/rename/delete folders and
// upload/remove templates, bypassing the same "documents" gate its sibling
// documents.routes.ts already enforces.
documentFoldersRouter.use(requireAuth, withDb, requireDepartmentAccess("documents"));

// memoryStorage: files are modest-sized real documents (policies,
// procedures, forms), and uploadTemplate/uploadDocument decide the on-disk
// path themselves — simpler than a disk-storage destination callback. Any
// file type is accepted (see attachFileToFolder's own comment) — real
// controlled documents aren't always PDFs.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

documentFoldersRouter.get("/", list);
documentFoldersRouter.post("/", validate(createDocumentFolderSchema), create);
// Fixed literal path before ":id"-shaped ones — the one-step "create a
// leaf + attach a file" upload, not scoped to an existing node.
documentFoldersRouter.post("/upload", upload.single("file"), uploadDocument);
documentFoldersRouter.patch("/:id", validate(updateDocumentFolderSchema), update);
documentFoldersRouter.delete("/:id", remove);

documentFoldersRouter.post("/:id/template", upload.single("file"), uploadTemplate);
documentFoldersRouter.get("/:id/template", downloadTemplate);
documentFoldersRouter.delete("/:id/template", removeTemplate);
