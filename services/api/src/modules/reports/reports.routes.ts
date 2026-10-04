import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { validate } from "../../middleware/validate.js";
import { withSiteContext } from "../sites/siteContext.js";
import { reportExportSchema, reportRunSchema } from "./reports.validation.js";
import {
  adhocReportHandler,
  exportReportHandler,
  getTemplateHandler,
  listTemplatesHandler,
  monthlyReportHandler,
  scheduleReportHandler,
  weeklyReportHandler,
} from "./reports.controller.js";

/**
 * Quality reports read the module tables that already exist. Each section
 * uses the same department access as that module. Runs are logged as
 * report_access. PDF is the same report. Scheduled email stays a stub.
 */
export const reportsRouter = Router();
reportsRouter.use(requireAuth, withDb, withSiteContext);

reportsRouter.get("/templates", listTemplatesHandler);
reportsRouter.get("/templates/:key", getTemplateHandler);
reportsRouter.get("/schedule", scheduleReportHandler);
reportsRouter.post("/schedule", scheduleReportHandler);
reportsRouter.post("/weekly", validate(reportRunSchema), weeklyReportHandler);
reportsRouter.post("/monthly", validate(reportRunSchema), monthlyReportHandler);
reportsRouter.post("/adhoc", validate(reportRunSchema), adhocReportHandler);
reportsRouter.get("/export", validate(reportExportSchema, "query"), exportReportHandler);
