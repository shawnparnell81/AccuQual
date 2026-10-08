import { and, eq } from "drizzle-orm";
import { db as ownerDb } from "../../db/index.js";
import type { Db } from "../../lib/requestDb.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { workflowDefinitions } from "../../drizzle/schema/workflow.js";
import { logger } from "../../utils/logger.js";
import { titlesFromConfig } from "../workflow/assignees.js";
import { NCR_PROCESS_NAME, ncrProcessDefinition } from "../workflow/ncrProcess.workflow.js";
import type { WorkflowNode } from "../workflow/workflow-engine.js";
import { deliverInAppNotices } from "./ncrNotices.js";
import { evaluateSla } from "./ncrSla.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function approverTitles(db: Db): Promise<string[]> {
  const [row] = await db.select({ definition: workflowDefinitions.definition }).from(workflowDefinitions).where(and(eq(workflowDefinitions.name, NCR_PROCESS_NAME), eq(workflowDefinitions.module, "ncr")));
  const stored = (row?.definition as { nodes?: WorkflowNode[] } | undefined)?.nodes;
  const nodes = stored?.length ? stored : ncrProcessDefinition.nodes;
  const node = nodes.find((item) => item.id === "ap14") ?? nodes.find((item) => item.label === "Management Approval");
  return titlesFromConfig(node?.config);
}

/** Refresh SLA columns and in-app reminders. Does not change ncr.status or updatedAt. */
export async function runNcrSlaSweep(db: Db = ownerDb as unknown as Db, now = new Date()): Promise<{ checked: number; noticed: number }> {
  const titles = await approverTitles(db);
  const rows = await db.select().from(ncr).where(eq(ncr.isDeleted, false));
  let noticed = 0;
  for (const row of rows) {
    const data = asRecord(row.processData);
    const stage = row.workflowStage ?? (typeof data.workflow_stage === "string" ? data.workflow_stage : null);
    const closed = stage === "Closed" || stage === "Rejected" || data.status === "Closed" || row.status === "closed";
    if (closed && row.slaStatus) continue;
    if (!stage && !data.status) continue;
    const openedAt = text(data.date_opened) ? new Date(String(data.date_opened)) : row.createdAt ? new Date(row.createdAt) : null;
    const noticesSent = Array.isArray(data.noticesSent) ? [...(data.noticesSent as string[])] : [];
    const evaluation = evaluateSla({
      now,
      ncrNumber: text(data.ncr_number) ?? "",
      severity: data.severity ?? row.severity,
      workflowStage: stage,
      openedAt,
      stageEnteredAt: text(data.stageEnteredAt) ? new Date(String(data.stageEnteredAt)) : openedAt,
      lastCorrectiveActionAt: text(data.lastCorrectiveActionAt) ? new Date(String(data.lastCorrectiveActionAt)) : null,
      implementationRisk: data.implementation_risk,
      closed,
      noticesSent,
      correctiveActionDueAt: text(data.due_date) ? new Date(String(data.due_date)) : row.dueDate ? new Date(row.dueDate) : null,
      correctiveActionComplete: data.corrective_action_complete === true || data.corrective_action_complete === "Yes",
      ncrType: data.ncr_type,
    });
    if (evaluation.escalationLevel) data.escalationLevel = evaluation.escalationLevel;
    const alert = evaluation.notices.find((notice) => notice.dashboardAlert)?.dashboardAlert;
    if (alert) data.dashboardAlert = alert;
    if (evaluation.priority && data.priority == null) data.priority = evaluation.priority;
    const delivered = await deliverInAppNotices(db, evaluation.notices, data, titles, row.assignedTo, row.id);
    if (delivered.length > 0) {
      data.noticesSent = [...noticesSent, ...delivered];
      noticed += delivered.length;
    }
    await db
      .update(ncr)
      .set({
        processData: data,
        slaTargetDate: evaluation.slaTargetDate,
        slaDueDate: evaluation.slaDueDate,
        slaStatus: evaluation.slaStatus,
        slaWarningSent: evaluation.warning || row.slaWarningSent,
        slaEscalated: evaluation.escalated || row.slaEscalated,
        stageDueDate: evaluation.stageDueDate,
        daysOpen: evaluation.daysOpen,
        daysInStage: evaluation.daysInStage,
      })
      .where(eq(ncr.id, row.id));
  }
  return { checked: rows.length, noticed };
}

let sweepHandle: ReturnType<typeof setInterval> | null = null;

export function startNcrSlaSweep(): void {
  if (sweepHandle) return;
  const first = setTimeout(() => void runNcrSlaSweep().catch((err) => logger.error("NCR SLA sweep failed", { err: String(err) })), 2 * 60_000);
  first.unref?.();
  sweepHandle = setInterval(() => void runNcrSlaSweep().catch((err) => logger.error("NCR SLA sweep failed", { err: String(err) })), 3_600_000);
  sweepHandle.unref?.();
}
