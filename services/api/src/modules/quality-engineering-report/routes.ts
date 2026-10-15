import { Router } from "express";
import { scanUploads } from "../upload-scan/uploadScan.js";
import multer from "multer";
import { validate } from "../../middleware/validate.js";
import { emailEngineeringReportSchema, saveEngineeringReportSchema, updateReportImageSchema } from "./validation.js";
import {
  engineeringDeleteHandler,
  engineeringEmailHandler,
  engineeringGetHandler,
  engineeringImageCaptionHandler,
  engineeringImageDeleteHandler,
  engineeringHelpHandler,
  engineeringPdfHandler,
  engineeringPeopleHandler,
  engineeringSaveHandler,
  engineeringTemplateHandler,
  engineeringUploadHandler,
  engineeringSourceCommitHandler,
  engineeringVerifyHandler, engineeringUnlockHandler,
  engineeringSourceListHandler,
  engineeringSourcePreviewHandler,
} from "./controller.js";

// Source workbooks (claim trackers) run larger than a supplier summary file.
const sourceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

/** Mounted at /reports/engineering. Auth, database, and plant context come from the reports router. */
export const engineeringReportRouter = Router();

engineeringReportRouter.get("/help", engineeringHelpHandler);
engineeringReportRouter.get("/people", engineeringPeopleHandler);
engineeringReportRouter.get("/template.csv", engineeringTemplateHandler);
engineeringReportRouter.get("/pdf", engineeringPdfHandler);
engineeringReportRouter.get("/", engineeringGetHandler);
engineeringReportRouter.put("/", validate(saveEngineeringReportSchema), engineeringSaveHandler);
engineeringReportRouter.delete("/", engineeringDeleteHandler);
engineeringReportRouter.post("/email", validate(emailEngineeringReportSchema), engineeringEmailHandler);
engineeringReportRouter.patch("/images/:attachmentId", validate(updateReportImageSchema), engineeringImageCaptionHandler);
engineeringReportRouter.delete("/images/:attachmentId", engineeringImageDeleteHandler);
engineeringReportRouter.post("/upload", upload.single("file"), scanUploads("Monthly Quality Report > supplier file"), engineeringUploadHandler);
engineeringReportRouter.get("/sources", engineeringSourceListHandler);
engineeringReportRouter.post("/sources/preview", sourceUpload.single("file"), scanUploads("Monthly Quality Report > source file"), engineeringSourcePreviewHandler);
engineeringReportRouter.post("/sources", sourceUpload.single("file"), scanUploads("Monthly Quality Report > source file"), engineeringSourceCommitHandler);
engineeringReportRouter.post("/verify", engineeringVerifyHandler);
engineeringReportRouter.post("/unlock", engineeringUnlockHandler);
