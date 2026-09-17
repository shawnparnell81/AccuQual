import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createDocumentSchema, updateDocumentSchema, addVersionSchema, approveSchema } from "./documents.validation.js";
import {
  baseHandlers,
  addVersionHandler,
  uploadVersionHandler,
  downloadVersionHandler,
  approveHandler,
  obsoleteHandler,
  historyHandler,
  listExpiringHandler,
  applyRetentionHandler,
  archiveHandler,
} from "./documents.controller.js";

// Sprint 1 fix (accuqual-implementation-sequencing.md) — previously had NO
// RBAC gate at all. Solved without blocking the "read-by-everyone,
// write-by-few" shape this file's old comment was protecting: every
// department gets at least "read" in defaultPermissions.ts's `documents`
// entry, so requireDepartmentAccess's existing read-vs-edit split already
// lets everyone view released documents (GET) while only Quality/Engineering
// (the two real document-owning departments) can write.
export const documentsRouter = Router();
documentsRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("documents"));

// Same memoryStorage pattern as document-folders/calibration.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Fixed-path routes first — "expiring" and "retention" would otherwise be
// swallowed by GET/POST "/:id"-shaped routes below.
documentsRouter.get("/expiring", listExpiringHandler);
documentsRouter.post("/retention/apply", applyRetentionHandler);

documentsRouter.get("/", baseHandlers.list);
documentsRouter.post("/", validate(createDocumentSchema), baseHandlers.create);
documentsRouter.get("/:id", baseHandlers.getOne);
documentsRouter.patch("/:id", validate(updateDocumentSchema), baseHandlers.update);
documentsRouter.post("/:id/version", validate(addVersionSchema), addVersionHandler);
documentsRouter.post("/:id/version/upload", upload.single("file"), uploadVersionHandler);
documentsRouter.get("/version/:versionId/file", downloadVersionHandler);
documentsRouter.post("/:id/approve", validate(approveSchema), approveHandler);
documentsRouter.post("/:id/obsolete", obsoleteHandler);
// On-demand version of the "retention/apply" sweep for a single document.
documentsRouter.post("/:id/archive", archiveHandler);
documentsRouter.get("/:id/history", historyHandler);
