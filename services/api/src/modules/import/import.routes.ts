import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { describeHandler, entityGate, previewHandler, runHandler, templateHandler } from "./import.controller.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

/** Bulk import from Excel/CSV: /import/:entity where entity is suppliers, inventory_items or people. Each type is gated by the same access its module already requires. */
export const importRouter = Router();
importRouter.use(requireAuth, withTenantDb);

importRouter.get("/:entity", entityGate, describeHandler);
importRouter.get("/:entity/template", entityGate, templateHandler);
importRouter.post("/:entity/preview", entityGate, upload.single("file"), previewHandler);
importRouter.post("/:entity/run", entityGate, upload.single("file"), runHandler);
