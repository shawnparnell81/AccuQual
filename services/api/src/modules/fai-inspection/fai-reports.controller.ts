import type { Request, Response } from "express";
import { AppError } from "../../utils/appError.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { toExcel, toPdf, type ExportableReport } from "../reporting/reporting.export.js";
import { company } from "../../drizzle/schema/company.js";
import { users } from "../../drizzle/schema/users.js";
import { eq } from "drizzle-orm";
import {
  aqlLotReport, sourceQualificationReport, randomPullComplianceReport, supplierFaiPerformanceReport,
  type FaiReportFilters,
} from "./fai-reports.service.js";

const BUILDERS: Record<string, (db: any, user: any, f: FaiReportFilters) => Promise<Omit<ExportableReport, "generatedAt" | "generatedBy" | "companyName">>> = {
  "aql-lot": aqlLotReport,
  "source-qualification": sourceQualificationReport,
  "random-pull-compliance": randomPullComplianceReport,
  "supplier-performance": supplierFaiPerformanceReport,
};

function parseFilters(req: Request): FaiReportFilters {
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? new Date(String(req.query.to)) : undefined;
  const siteId = req.query.siteId ? Number(req.query.siteId) : null;
  const supplierId = req.query.supplierId ? Number(req.query.supplierId) : null;
  return {
    from: from && !isNaN(from.getTime()) ? from : undefined,
    to: to && !isNaN(to.getTime()) ? to : undefined,
    siteId: Number.isInteger(siteId) && siteId! > 0 ? siteId : null,
    supplierId: Number.isInteger(supplierId) && supplierId! > 0 ? supplierId : null,
    partNumber: req.query.partNumber ? String(req.query.partNumber) : null,
    productFamily: req.query.productFamily ? String(req.query.productFamily) : null,
  };
}

export const exportFaiReport = asyncHandler(async (req: Request, res: Response) => {
  const reportKey = req.params.reportKey!;
  const format = (req.query.format as string) ?? "pdf";
  const builder = BUILDERS[reportKey];
  if (!builder) throw AppError.badRequest(`Unknown FAI report "${reportKey}"`);
  if (format !== "pdf" && format !== "excel") throw AppError.badRequest(`Unsupported format "${format}" — use pdf or excel.`);

  const db = req.db!;
  const [co] = await db.select().from(company);
  const [performer] = req.user?.id ? await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, req.user.id)) : [undefined];

  const partial = await builder(db, req.user, parseFilters(req));
  const report: ExportableReport = {
    ...partial,
    generatedAt: new Date(),
    generatedBy: performer?.name || performer?.email || "User",
    companyName: co?.name ?? "AccuQual",
  };

  await recordAuditTrail(db, {
    entityType: "FaiReportExport", entityId: 1, action: "create",
    changes: { reportKey, format, rowCount: report.rows.length },
    performedBy: req.user?.id,
  });

  const filename = `fai-${reportKey}-${new Date().toISOString().slice(0, 10)}`;
  if (format === "excel") {
    const buffer = await toExcel(report);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
    res.send(buffer);
  } else {
    const bytes = await toPdf(report);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
    res.send(Buffer.from(bytes));
  }
});

/** Same data the export builds from, as JSON — for the report preview in the web app before someone downloads it. */
export const previewFaiReport = asyncHandler(async (req: Request, res: Response) => {
  const reportKey = req.params.reportKey!;
  const builder = BUILDERS[reportKey];
  if (!builder) throw AppError.badRequest(`Unknown FAI report "${reportKey}"`);
  res.json(await builder(req.db!, req.user, parseFilters(req)));
});
