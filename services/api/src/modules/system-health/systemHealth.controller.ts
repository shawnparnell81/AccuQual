import type { Request, Response } from "express";
import { and, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { pool } from "../../db/index.js";
import { company } from "../../drizzle/schema/company.js";
import { aiSuggestions } from "../../drizzle/schema/ai.js";
import { inventoryAlerts } from "../../drizzle/schema/inventory.js";
import { reportSchedules } from "../../drizzle/schema/reporting.js";
import { notificationLog } from "../../drizzle/schema/notifications.js";
import { users } from "../../drizzle/schema/users.js";
import { env } from "../../config/env.js";
import { buildWorkflowHealthReport } from "../workflow/workflow.controller.js";
import { currentAlerts } from "../monitoring/alerts.js";
import { metrics } from "../monitoring/metrics.js";
import { sentryEnabled } from "../monitoring/sentry.js";
import type { Db } from "../../lib/requestDb.js";

type Status = "ok" | "warning" | "critical";

interface HealthCheck {
  status: Status;
  detail: string;
  [key: string]: unknown;
}

const SEVEN_DAYS_AGO = () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

async function checkDatabase(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    await pool.query("SELECT 1");
    const latencyMs = Date.now() - start;
    return { status: latencyMs > 500 ? "warning" : "ok", latencyMs, detail: `Reachable, ${latencyMs}ms` };
  } catch (err) {
    return { status: "critical", latencyMs: Date.now() - start, detail: `Unreachable: ${(err as Error).message}` };
  }
}

/** Mode mirrors tenant.controller.ts's getAiConfigHandler keyStatus logic exactly — "live" here is that function's "ready". */
async function checkAi(db: Db): Promise<HealthCheck> {
  const [co] = await db.select({ aiConfig: company.aiConfig }).from(company);
  const mode: "live" | "stub" = co?.aiConfig?.apiKeyEncrypted || env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY ? "live" : "stub";

  const since = SEVEN_DAYS_AGO();
  const recent = await db
    .select({ status: aiSuggestions.status })
    .from(aiSuggestions)
    .where(and(gte(aiSuggestions.createdAt, since)));
  const errorCount = recent.filter((r) => r.status === "error").length;
  const total = recent.length;
  const errorRate = total > 0 ? errorCount / total : 0;

  const status: Status = total > 0 && errorRate > 0.5 ? "critical" : errorCount > 0 ? "warning" : "ok";
  return {
    status,
    mode,
    recentTotal: total,
    recentErrorCount: errorCount,
    detail: mode === "stub" ? "No AI key configured — every AI feature runs in stub mode" : `${errorCount}/${total} AI calls failed in the last 7 days`,
  };
}

async function checkWorkflow(db: Db): Promise<HealthCheck> {
  const { summary } = await buildWorkflowHealthReport(db);
  const status: Status = summary.withIssues > 0 ? "warning" : "ok";
  return { status, ...summary, detail: `${summary.active}/${summary.total} workflow definitions active, ${summary.withIssues} with structural issues` };
}

async function checkEmail(db: Db): Promise<HealthCheck> {
  const since = SEVEN_DAYS_AGO();
  const rows = await db
    .select({ status: notificationLog.status, count: sql<number>`count(*)::int` })
    .from(notificationLog)
    .where(and(gte(notificationLog.createdAt, since)))
    .groupBy(notificationLog.status);

  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.count]));
  const sent = byStatus.sent ?? 0;
  const failed = byStatus.failed ?? 0;
  const loggedOnly = byStatus.logged_only ?? 0;
  const total = sent + failed + loggedOnly;

  const status: Status = total > 0 && failed / total > 0.2 ? "critical" : failed > 0 ? "warning" : "ok";
  return {
    status,
    sent,
    failed,
    loggedOnly,
    detail: loggedOnly > 0 && sent === 0 && failed === 0 ? "No real email transport configured — notifications are logged only" : `${failed} failed of ${total} notifications in the last 7 days`,
  };
}

async function checkReporting(db: Db): Promise<HealthCheck> {
  const rows = await db.select().from(reportSchedules);
  const enabled = rows.filter((r) => r.enabled);
  const failedLastRun = enabled.filter((r) => r.lastRunStatus === "failed" || r.lastRunStatus === "error");
  const overdue = enabled.filter((r) => r.nextRunAt && new Date(r.nextRunAt) < new Date());

  const status: Status = failedLastRun.length > 0 ? "warning" : "ok";
  return {
    status,
    totalSchedules: rows.length,
    enabledSchedules: enabled.length,
    failedSchedules: failedLastRun.length,
    overdueSchedules: overdue.length,
    detail: rows.length === 0 ? "No scheduled reports configured" : `${failedLastRun.length} schedule(s) last failed, ${overdue.length} overdue (no background scheduler — see /reporting)`,
  };
}

async function checkReceivingInventory(db: Db): Promise<HealthCheck> {
  const rows = await db
    .select({ id: inventoryAlerts.id })
    .from(inventoryAlerts)
    .where(and(eq(inventoryAlerts.alertType, "below_min"), isNull(inventoryAlerts.acknowledgedAt)));

  const status: Status = rows.length > 5 ? "warning" : "ok";
  return { status, itemsBelowMin: rows.length, detail: `${rows.length} item(s) below minimum stock level, unacknowledged` };
}

async function checkSupplierPortal(db: Db): Promise<HealthCheck> {
  const supplierUsers = await db
    .select({ id: users.id, lastLoginAt: users.lastLoginAt })
    .from(users)
    .where(and(isNotNull(users.supplierId), eq(users.isActive, true)));

  const since = SEVEN_DAYS_AGO();
  const recentlyActive = supplierUsers.filter((u) => u.lastLoginAt && new Date(u.lastLoginAt) >= since).length;

  return {
    status: "ok",
    activeSupplierUsers: supplierUsers.length,
    recentlyActiveCount: recentlyActive,
    detail: supplierUsers.length === 0 ? "No supplier portal logins provisioned" : `${recentlyActive}/${supplierUsers.length} supplier users logged in within the last 7 days`,
  };
}

/** The monitoring system itself: what is firing right now, and which of its outside connections are switched on. */
function checkMonitoring(): HealthCheck {
  const alerts = currentAlerts();
  const firing = alerts.filter((a) => a.firing);
  const requests5m = metrics.requests.total(5 * 60_000);
  const errors5m = metrics.serverErrors.total(5 * 60_000);
  return {
    status: firing.some((a) => a.key === "database") ? "critical" : firing.length > 0 ? "warning" : "ok",
    detail: firing.length === 0 ? "No alerts firing" : `${firing.length} alert${firing.length === 1 ? "" : "s"} firing: ${firing.map((a) => a.title).join(", ")}`,
    alerts,
    requests5m,
    serverErrors5m: errors5m,
    version: env.APP_VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    configured: {
      errorTracking: sentryEnabled(),
      alertWebhook: !!env.ALERT_WEBHOOK_URL,
      heartbeat: !!env.HEARTBEAT_URL,
      workersMonitored: env.MONITOR_EXPECTED_WORKERS.split(",").map((s) => s.trim()).filter(Boolean),
    },
  };
}

/**
 * GET /system-health — Phase 10's System Health dashboard. Aggregates
 * lightweight signals from across the app into one consolidated view;
 * detailed drill-down for workflow issues stays at GET /workflow/health
 * (this reuses that exact same computation via buildWorkflowHealthReport,
 * not a re-implementation) rather than duplicating every module's own
 * detailed diagnostics page.
 */
export const getSystemHealthHandler = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db! as Db;

  const [database, ai, workflow, email, reporting, receivingInventory, supplierPortal] = await Promise.all([
    checkDatabase(),
    checkAi(db),
    checkWorkflow(db),
    checkEmail(db),
    checkReporting(db),
    checkReceivingInventory(db),
    checkSupplierPortal(db),
  ]);

  const checks = { database, monitoring: checkMonitoring(), ai, workflow, email, reporting, receivingInventory, supplierPortal };
  const overall: Status = Object.values(checks).some((c) => c.status === "critical")
    ? "critical"
    : Object.values(checks).some((c) => c.status === "warning")
      ? "warning"
      : "ok";

  res.json({ overall, checks, checkedAt: new Date().toISOString() });
});
