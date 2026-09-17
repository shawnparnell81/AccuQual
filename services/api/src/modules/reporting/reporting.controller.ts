import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { runPipelineAndRecord } from "../ai/ai.usage.js";
import * as pipelines from "../ai/ai.pipelines.js";
import { reportSchedules } from "../../drizzle/schema/reporting.js";
import { tenants } from "../../drizzle/schema/tenants.js";
import { users } from "../../drizzle/schema/users.js";
import * as reportingService from "./reporting.service.js";
import { computeNextRunAt, runReportSchedule } from "./reporting.scheduler.js";
import { toCsv, toExcel, toPdf, type ExportableReport } from "./reporting.export.js";
import type { TenantDb } from "../../lib/tenantScope.js";
import type { DateRange } from "./reporting.service.js";

function parseRange(req: Request): DateRange {
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? new Date(String(req.query.to)) : undefined;
  return { from: from && !isNaN(from.getTime()) ? from : undefined, to: to && !isNaN(to.getTime()) ? to : undefined };
}

export const ncrMetricsHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await reportingService.getNcrMetrics(req.db! as TenantDb, req.tenantId!, parseRange(req)));
});

export const capaMetricsHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await reportingService.getCapaMetrics(req.db! as TenantDb, req.tenantId!, parseRange(req)));
});

export const supplierPerformanceReportHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await reportingService.getSupplierPerformanceReport(req.db! as TenantDb, req.tenantId!));
});

export const warrantyTrendsHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await reportingService.getWarrantyTrends(req.db! as TenantDb, req.tenantId!, parseRange(req)));
});

export const receivingTrendsHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await reportingService.getReceivingTrends(req.db! as TenantDb, req.tenantId!, parseRange(req)));
});

export const inventoryQualityTrendsHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await reportingService.getInventoryQualityTrends(req.db! as TenantDb, req.tenantId!, parseRange(req)));
});

export const workflowCycleTimeHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await reportingService.getWorkflowCycleTimeMetrics(req.db! as TenantDb, req.tenantId!, parseRange(req)));
});

// ---------------------------------------------------------------------------
// AI-assisted report summaries — always a suggestion over already-real,
// already-aggregated data; never written back into any stored report.
// ---------------------------------------------------------------------------
const SUMMARY_INPUT_LOADERS: Record<string, (db: TenantDb, tenantId: number) => Promise<unknown>> = {
  quality_trends: (db, tenantId) => reportingService.getNcrMetrics(db, tenantId),
  supplier_risk_changes: (db, tenantId) => reportingService.getSupplierPerformanceReport(db, tenantId),
  warranty_patterns: (db, tenantId) => reportingService.getWarrantyTrends(db, tenantId),
  production_deviations: (db, tenantId) => reportingService.getInventoryQualityTrends(db, tenantId),
};

export const reportSummaryHandler = asyncHandler(async (req: Request, res: Response) => {
  const { kind } = req.body as { kind: string };
  const db = req.db! as TenantDb;
  const tenantId = req.tenantId!;
  const input = await SUMMARY_INPUT_LOADERS[kind]!(db, tenantId);

  const { suggestion, output } = await runPipelineAndRecord(db, tenantId, req.user?.id, "reporting", `report_summary_${kind}`, { kind, input }, "AI-generated report summary", (opts) =>
    pipelines.runReportSummaryPipeline(kind, input, opts)
  );
  res.json({ ...suggestion, output });
});

// ---------------------------------------------------------------------------
// Scheduled reports — CRUD + manual "Send Now" dispatch.
// ---------------------------------------------------------------------------
export const listReportSchedulesHandler = asyncHandler(async (req: Request, res: Response) => {
  const rows = await req.db!.select().from(reportSchedules).where(eq(reportSchedules.tenantId, req.tenantId!));
  res.json(rows);
});

export const createReportScheduleHandler = asyncHandler(async (req: Request, res: Response) => {
  const { reportType, frequency, recipients, enabled } = req.body as { reportType: string; frequency: "daily" | "weekly" | "monthly"; recipients: string[]; enabled?: boolean };
  const [created] = await req
    .db!.insert(reportSchedules)
    .values({ tenantId: req.tenantId!, reportType, frequency, recipients, enabled: enabled ?? true, nextRunAt: computeNextRunAt(frequency), createdBy: req.user?.id })
    .returning();

  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "ReportSchedule", entityId: created!.id, action: "create", changes: { reportType, frequency, recipients }, performedBy: req.user?.id });
  res.status(201).json(created);
});

async function loadSchedule(req: Request, id: number) {
  const [row] = await req.db!.select().from(reportSchedules).where(and(eq(reportSchedules.id, id), eq(reportSchedules.tenantId, req.tenantId!)));
  if (!row) throw AppError.notFound("ReportSchedule");
  return row;
}

export const updateReportScheduleHandler = asyncHandler(async (req: Request, res: Response) => {
  const existing = await loadSchedule(req, Number(req.params.id));
  const patch = req.body as Partial<{ reportType: string; frequency: "daily" | "weekly" | "monthly"; recipients: string[]; enabled: boolean }>;
  const nextRunAt = patch.frequency && patch.frequency !== existing.frequency ? computeNextRunAt(patch.frequency) : undefined;

  const [updated] = await req
    .db!.update(reportSchedules)
    .set({ ...patch, ...(nextRunAt ? { nextRunAt } : {}), updatedAt: new Date() })
    .where(eq(reportSchedules.id, existing.id))
    .returning();

  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "ReportSchedule", entityId: existing.id, action: "update", changes: patch, performedBy: req.user?.id });
  res.json(updated);
});

export const deleteReportScheduleHandler = asyncHandler(async (req: Request, res: Response) => {
  const existing = await loadSchedule(req, Number(req.params.id));
  await req.db!.delete(reportSchedules).where(eq(reportSchedules.id, existing.id));
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "ReportSchedule", entityId: existing.id, action: "delete", changes: { reportType: existing.reportType }, performedBy: req.user?.id });
  res.status(204).send();
});

/** POST /reporting/schedules/:id/send-now — manual dispatch, bypassing nextRunAt; updates the same lastRunAt/lastRunStatus fields a real scheduled run would. */
export const sendReportScheduleNowHandler = asyncHandler(async (req: Request, res: Response) => {
  const existing = await loadSchedule(req, Number(req.params.id));
  await runReportSchedule(existing.id);
  const refreshed = await loadSchedule(req, existing.id);
  res.json(refreshed);
});

// ---------------------------------------------------------------------------
// Export — PDF / CSV / Excel, gated by the same per-report ResourceKey as
// the underlying data (see reporting.routes.ts), and every format carries
// the same audit-metadata line ("Ensure exports include audit metadata").
// ---------------------------------------------------------------------------
const EXPORT_BUILDERS: Record<string, (db: TenantDb, tenantId: number, range: DateRange) => Promise<Omit<ExportableReport, "generatedAt" | "generatedBy" | "tenantName">>> = {
  "ncr-metrics": async (db, tenantId, range) => {
    const m = await reportingService.getNcrMetrics(db, tenantId, range);
    return { title: "NCR Summary", columns: ["Status", "Count"], rows: m.byStatus.map((s) => [s.status, s.count]) };
  },
  "capa-metrics": async (db, tenantId, range) => {
    const m = await reportingService.getCapaMetrics(db, tenantId, range);
    return { title: "CAPA Summary", columns: ["Status", "Count"], rows: m.byStatus.map((s) => [s.status, s.count]) };
  },
  "supplier-performance": async (db, tenantId) => {
    const r = await reportingService.getSupplierPerformanceReport(db, tenantId);
    return {
      title: "Supplier Scorecard",
      columns: ["Supplier", "Risk", "Avg Delivery (days)", "Accuracy (%)"],
      rows: r.suppliers.map((s) => [s.name, s.riskScore, s.onTimeAvgDays ?? "n/a", s.accuracyAvgPercent ?? "n/a"]),
    };
  },
  "warranty-trends": async (db, tenantId, range) => {
    const m = await reportingService.getWarrantyTrends(db, tenantId, range);
    return { title: "Warranty / RMA Summary", columns: ["Status", "Count"], rows: m.byStatus.map((s) => [s.status, s.count]) };
  },
  "receiving-trends": async (db, tenantId, range) => {
    const m = await reportingService.getReceivingTrends(db, tenantId, range);
    return { title: "Receiving Inspection Summary", columns: ["Final Status", "Count"], rows: m.byFinalStatus.map((s) => [s.status, s.count]) };
  },
  "inventory-quality-trends": async (db, tenantId, range) => {
    const m = await reportingService.getInventoryQualityTrends(db, tenantId, range);
    const scrapByMonth = new Map(m.scrapByMonth.map((s) => [s.month, s.quantity]));
    const consumptionByMonth = new Map(m.consumptionByMonth.map((s) => [s.month, s.quantity]));
    const months = [...new Set([...scrapByMonth.keys(), ...consumptionByMonth.keys()])].sort();
    return {
      title: "Inventory Quality Summary",
      columns: ["Month", "Scrap Qty", "Consumption Qty"],
      rows: months.map((month) => [month, scrapByMonth.get(month) ?? 0, consumptionByMonth.get(month) ?? 0]),
    };
  },
};

export const exportReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const reportKey = req.params.reportKey!;
  const format = (req.query.format as string) ?? "csv";
  const builder = EXPORT_BUILDERS[reportKey];
  if (!builder) throw AppError.badRequest(`Unknown report "${reportKey}"`);

  const db = req.db! as TenantDb;
  const tenantId = req.tenantId!;
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  const [performer] = req.user?.id ? await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, req.user.id)) : [undefined];

  const partial = await builder(db, tenantId, parseRange(req));
  const report: ExportableReport = {
    ...partial,
    generatedAt: new Date(),
    generatedBy: performer?.name || performer?.email || `User #${req.user?.id}`,
    tenantName: tenant?.name ?? `Tenant #${tenantId}`,
  };

  await recordAuditTrail(db, {
    tenantId,
    entityType: "ReportExport",
    entityId: tenantId,
    action: "create",
    changes: { reportKey, format, rowCount: report.rows.length },
    performedBy: req.user?.id,
  });

  const filename = `${reportKey}-${new Date().toISOString().slice(0, 10)}`;
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    res.send(toCsv(report));
  } else if (format === "excel") {
    const buffer = await toExcel(report);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
    res.send(buffer);
  } else if (format === "pdf") {
    const bytes = await toPdf(report);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
    res.send(Buffer.from(bytes));
  } else {
    throw AppError.badRequest(`Unsupported export format "${format}" — use csv, excel, or pdf.`);
  }
});
