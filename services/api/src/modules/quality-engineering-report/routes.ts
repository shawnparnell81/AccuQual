import { Router } from "express";
import multer from "multer";
import { validate } from "../../middleware/validate.js";
import { emailEngineeringReportSchema, saveEngineeringReportSchema } from "./validation.js";
import {
  engineeringEmailHandler,
  engineeringGetHandler,
  engineeringHelpHandler,
  engineeringPdfHandler,
  engineeringPeopleHandler,
  engineeringSaveHandler,
  engineeringTemplateHandler,
  engineeringUploadHandler,
} from "./controller.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

/** Mounted at /reports/engineering. Auth, database, and plant context come from the reports router. */
export const engineeringReportRouter = Router();

engineeringReportRouter.get("/help", engineeringHelpHandler);
engineeringReportRouter.get("/people", engineeringPeopleHandler);
engineeringReportRouter.get("/template.csv", engineeringTemplateHandler);
engineeringReportRouter.get("/pdf", engineeringPdfHandler);
engineeringReportRouter.get("/", engineeringGetHandler);
engineeringReportRouter.put("/", validate(saveEngineeringReportSchema), engineeringSaveHandler);
engineeringReportRouter.post("/email", validate(emailEngineeringReportSchema), engineeringEmailHandler);
engineeringReportRouter.post("/upload", upload.single("file"), engineeringUploadHandler);
