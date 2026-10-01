import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { logger } from "../../utils/logger.js";
import { WeeklyReportService } from "./WeeklyReportService.js";
import { MonthlyReportService } from "./MonthlyReportService.js";
import { AdHocReportService } from "./AdHocReportService.js";
import { ReportTemplateService } from "./ReportTemplateService.js";
import { ReportExportService } from "./ReportExportService.js";
import { reportScheduleStub } from "./reports.scheduler.js";
import type { RunReportInput } from "./reports.run.js";

function runInput(req: Request): Omit<RunReportInput, "kind"> {
  const body = req.body as { from?: string; to?: string; plantId?: number | "all" };
  return {
    from: body.from,
    to: body.to,
    plantId: body.plantId,
    user: { id: req.user!.id, roleName: req.user!.roleName, department: req.user!.department },
    allowedSiteIds: req.allowedSiteIds ?? [],
    currentSiteId: req.siteId ?? null,
  };
}

export const listTemplatesHandler = asyncHandler(async (_req: Request, res: Response) => {
  res.json(ReportTemplateService.list());
});

export const getTemplateHandler = asyncHandler(async (req: Request, res: Response) => {
  const template = ReportTemplateService.get(String(req.params.key ?? ""));
  if (!template) throw AppError.notFound("Report template");
  res.json(template);
});

export const weeklyReportHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await WeeklyReportService.run(req.db!, runInput(req)));
});

export const monthlyReportHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await MonthlyReportService.run(req.db!, runInput(req)));
});

export const adhocReportHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await AdHocReportService.run(req.db!, runInput(req)));
});

export const scheduleReportHandler = asyncHandler(async (req: Request, res: Response) => {
  logger.info("report_access", { userId: req.user!.id, kind: "schedule", outcome: "stub" });
  res.json(reportScheduleStub());
});

export const exportReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as { type: "weekly" | "monthly" | "adhoc"; format: "csv" | "json" | "pdf"; from?: string; to?: string; plantId?: number | "all" };
  if (query.format === "pdf") {
    logger.info("report_access", { userId: req.user!.id, kind: query.type, format: "pdf", outcome: "stub" });
    res.json(ReportExportService.pdfStub());
    return;
  }

  const input: Omit<RunReportInput, "kind"> = {
    from: query.from,
    to: query.to,
    plantId: query.plantId,
    user: { id: req.user!.id, roleName: req.user!.roleName, department: req.user!.department },
    allowedSiteIds: req.allowedSiteIds ?? [],
    currentSiteId: req.siteId ?? null,
  };
  const report =
    query.type === "weekly"
      ? await WeeklyReportService.run(req.db!, input)
      : query.type === "monthly"
        ? await MonthlyReportService.run(req.db!, input)
        : await AdHocReportService.run(req.db!, input);
  const file = query.format === "csv" ? ReportExportService.csv(report) : ReportExportService.json(report);
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
  res.send(file.body);
});
