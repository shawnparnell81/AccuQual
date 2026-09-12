import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { createDocumentSchema, updateDocumentSchema, addVersionSchema } from "./documents.validation.js";
import { baseHandlers, addVersionHandler, approveHandler, historyHandler } from "./documents.controller.js";

export const documentsRouter = Router();
documentsRouter.use(requireAuth, withTenantDb);

documentsRouter.get("/", baseHandlers.list);
documentsRouter.post("/", validate(createDocumentSchema), baseHandlers.create);
documentsRouter.get("/:id", baseHandlers.getOne);
documentsRouter.patch("/:id", validate(updateDocumentSchema), baseHandlers.update);
documentsRouter.post("/:id/version", validate(addVersionSchema), addVersionHandler);
documentsRouter.post("/:id/approve", approveHandler);
documentsRouter.get("/:id/history", historyHandler);
