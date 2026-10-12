import { Router } from "express";
import * as c from "./fai-reports.controller.js";

/** Mounted at /fai-inspection/reports. */
export const faiReportsRouter = Router();
faiReportsRouter.get("/:reportKey/preview", c.previewFaiReport);
faiReportsRouter.get("/:reportKey/export", c.exportFaiReport);
