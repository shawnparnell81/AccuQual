import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createDocumentSchema, updateDocumentSchema } from "./documents.validation.js";
import {
  baseHandlers,
  createDocumentHandler,
  retiredRevisionHandler,
  downloadVersionHandler,
  obsoleteHandler,
  historyHandler,
  listExpiringHandler,
  applyRetentionHandler,
  archiveHandler,
} from "./documents.controller.js";
import { registerDocumentVersionRoutes } from "./documents.versions.routes.js";

// Sprint 1 fix (accuqual-implementation-sequencing.md) — previously had NO
// RBAC gate at all. Solved without blocking the "read-by-everyone,
// write-by-few" shape this file's old comment was protecting: every
// department gets at least "read" in defaultPermissions.ts's `documents`
// entry, so requireDepartmentAccess's existing read-vs-edit split already
// lets everyone view released documents (GET) while only Quality/Engineering
// (the two real document-owning departments) can write.
//
// Document versioning: revisions are drafted, reviewed and published through the shared version-control engine
// (documents.versions.routes.ts), which adds its own per-action permission gate (document.view / edit / review / publish).
export const documentsRouter = Router();
documentsRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("documents"));

// Fixed-path routes first — "expiring" and "retention" would otherwise be
// swallowed by GET/POST "/:id"-shaped routes below.
documentsRouter.get("/expiring", listExpiringHandler);
documentsRouter.post("/retention/apply", applyRetentionHandler);
registerDocumentVersionRoutes(documentsRouter);

documentsRouter.get("/", baseHandlers.list);
documentsRouter.post("/", validate(createDocumentSchema), createDocumentHandler);
documentsRouter.get("/:id", baseHandlers.getOne);
documentsRouter.patch("/:id", validate(updateDocumentSchema), baseHandlers.update);

// Replaced by the draft -> review -> publish flow; they answer 410 with the new route instead of bypassing review.
documentsRouter.post("/:id/version", retiredRevisionHandler);
documentsRouter.post("/:id/version/upload", retiredRevisionHandler);
documentsRouter.post("/:id/approve", retiredRevisionHandler);

documentsRouter.get("/version/:versionId/file", downloadVersionHandler);
documentsRouter.post("/:id/obsolete", obsoleteHandler);
// On-demand version of the "retention/apply" sweep for a single document.
documentsRouter.post("/:id/archive", archiveHandler);
documentsRouter.get("/:id/history", historyHandler);
