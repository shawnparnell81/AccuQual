import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { uploadAttachmentHandler, listAttachmentsHandler, downloadAttachmentHandler, deleteAttachmentHandler } from "./attachments.controller.js";

export const attachmentsRouter = Router();
attachmentsRouter.use(requireAuth, withTenantDb);

// memoryStorage: attachmentsController decides the on-disk path itself —
// same convention as forms' template upload and calibration's certificate
// upload. 25MB cap (a bit more headroom than forms' 15MB — real-world
// evidence photos/scans run larger than a fillable PDF template).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

attachmentsRouter.get("/", listAttachmentsHandler);
attachmentsRouter.post("/", upload.single("file"), uploadAttachmentHandler);
attachmentsRouter.get("/:id/download", downloadAttachmentHandler);
attachmentsRouter.delete("/:id", deleteAttachmentHandler);
