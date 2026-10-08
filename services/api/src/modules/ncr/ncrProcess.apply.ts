import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { env } from "../../config/env.js";
import type { Db } from "../../lib/requestDb.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { scarForms } from "../../drizzle/schema/scarForms.js";
import { workflowDefinitions } from "../../drizzle/schema/workflow.js";
import { registerActionHandler, registerWorkflowProgressHook, type WorkflowNode } from "../workflow/workflow-engine.js";
import { titlesFromConfig } from "../workflow/assignees.js";
import { getFormLayout } from "../forms/layouts/index.js";
import { renderFormLayoutAsPdf } from "../forms/schema-pdf-renderer.js";
import { NCR_PROCESS_NAME, ncrProcessDefinition } from "../workflow/ncrProcess.workflow.js";
import { deliverInAppNotices } from "./ncrNotices.js";
import { addHours, evaluateSla, priorityForSeverity, severityClass, type SlaNotice, type StageMark } from "./ncrSla.js";

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const STAGE_BY_NODE: Record<string, string> = {
  a2: "Quality Review",
  ap3: "Quality Review",
  a5: "Rejected",
  a7: "Containment",
  a8: "Root Cause Analysis",
  a9: "Corrective Action",
  p10: "Implementation",
  a11: "Implementation",
  a12: "Implementation",
  a13: "Implementation",
  ap14: "Management Approval",
  a15: "Effectiveness Verification",
  a17: "Closed",
};

function copyMapped(context: Record<string, unknown>, data: Record<string, unknown>) {
  for (const key of ["ncr_number", "reported_by", "date_opened", "department", "part_number", "job_number", "lot_number", "supplier", "customer", "description", "severity", "ncr_type", "containment_required", "effective", "recurrence_detected", "corrective_action_overdue", "implementation_risk", "action_owner", "rca_owner", "due_date"]) {
    if (context[key] !== undefined && context[key] !== null && context[key] !== "") data[key] = context[key];
  }
}

async function managementTitles(db: Db): Promise<string[]> {
  const [row] = await db.select({ definition: workflowDefinitions.definition }).from(workflowDefinitions).where(and(eq(workflowDefinitions.name, NCR_PROCESS_NAME), eq(workflowDefinitions.module, "ncr")));
  const nodes = ((row?.definition as { nodes?: WorkflowNode[] } | undefined)?.nodes ?? ncrProcessDefinition.nodes) as WorkflowNode[];
  const node = nodes.find((item) => item.id === "ap14") ?? nodes.find((item) => item.label === "Management Approval");
  return titlesFromConfig(node?.config);
}

async function writeClosePdf(ncrId: number, data: Record<string, unknown>): Promise<string | null> {
  const layout = getFormLayout("ncr");
  if (!layout) return null;
  const bytes = await renderFormLayoutAsPdf(layout, { ...data, ncrNumber: text(data.ncr_number) ?? undefined });
  const dir = path.resolve(env.STORAGE_LOCAL_PATH, "ncr");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `ncr-${ncrId}-close.pdf`);
  await writeFile(file, bytes);
  return file;
}

async function applyStep(node: WorkflowNode, context: Record<string, unknown>, dryRun: boolean) {
  if (dryRun) return;
  const db = context.__db as Db | undefined;
  const ncrId = toNumber(context.entityId ?? context.ncrId);
  if (!db || !ncrId) return;
  const stage = STAGE_BY_NODE[node.id] ?? (typeof node.config.workflowStage === "string" ? node.config.workflowStage : null);
  const [row] = await db.select().from(ncr).where(eq(ncr.id, ncrId));
  if (!row || row.isDeleted) return;
  const now = new Date();
  const data = asRecord(row.processData);
  copyMapped(context, data);
  const history = Array.isArray(data.stageHistory) ? [...(data.stageHistory as StageMark[])] : [];
  if (stage && stage !== data.workflow_stage && node.id !== "a_open") {
    data.workflow_stage = stage;
    data.stageEnteredAt = now.toISOString();
    history.push({ stage, at: now.toISOString() });
    data.stageHistory = history;
  }
  const severity = severityClass(data.severity ?? row.severity);
  const priority = priorityForSeverity(severity);
  if (priority && data.priority == null) data.priority = priority;

  if (node.id === "a2") {
    data.status = "Submitted";
    data.date_opened = text(data.date_opened) ?? (row.createdAt ? new Date(row.createdAt).toISOString() : now.toISOString());
  } else if (node.id === "a5") {
    data.status = "Rejected";
    data.rejected_date = now.toISOString();
    data.rejected_by = toNumber(context.__performedBy) ?? null;
    data.rejection_reason = text(context.approval_comments) ?? text(context.review_notes);
  } else if (node.id === "a7") data.status = "Containment";
  else if (node.id === "a8") data.status = "Root Cause Analysis";
  else if (node.id === "a9") data.status = "Corrective Action";
  else if (node.id === "a15") {
    data.status = "Effectiveness Verification";
    if (!text(data.lastCorrectiveActionAt)) data.lastCorrectiveActionAt = now.toISOString();
  } else if (node.id === "a17") {
    data.status = "Closed";
    data.date_closed = now.toISOString();
    data.closure_notes = text(data.verification_notes) ?? text(context.verification_notes);
    data.archived = true;
    data.locked = true;
    const pdfPath = await writeClosePdf(ncrId, data);
    if (pdfPath) data.pdfPath = pdfPath;
  } else if (node.id === "a_open") {
    data.escalationLevel = "High";
  } else if (node.id === "a_crit") {
    data.priority = "Critical";
  } else if (node.id === "a_cust") {
    data.customerResponse = { dueAt: addHours(now, 48).toISOString(), status: "open" };
  } else if (node.id === "a_sup") {
    const [scar] = await db
      .insert(scarForms)
      .values({
        scarNumber: null,
        dateIssued: now,
        supplierId: row.supplierId,
        supplierName: text(data.supplier),
        defectDescription: text(data.description) ?? row.description,
        partNumberDescription: text(data.part_number),
        lotHeatNumber: text(data.lot_number),
        status: "open",
        createdBy: toNumber(context.__performedBy),
      })
      .returning({ id: scarForms.id });
    data.scarId = scar?.id ?? null;
    data.supplierResponse = { status: "open", scarId: scar?.id ?? null };
    data.supplierCorrectiveActions = Array.isArray(data.supplierCorrectiveActions) ? data.supplierCorrectiveActions : [];
  } else if (node.id === "a_od") {
    if (data.priority === "Normal") data.priority = "High";
    data.dashboardAlert = `Corrective action for NCR ${text(data.ncr_number) || "this record"} is overdue.`;
  }

  const openedAt = text(data.date_opened) ? new Date(String(data.date_opened)) : row.createdAt ? new Date(row.createdAt) : null;
  const noticesSent = Array.isArray(data.noticesSent) ? (data.noticesSent as string[]) : [];
  const evaluation = evaluateSla({
    now,
    ncrNumber: text(data.ncr_number) ?? "",
    severity: data.severity ?? row.severity,
    workflowStage: typeof data.workflow_stage === "string" ? data.workflow_stage : stage,
    openedAt,
    stageEnteredAt: text(data.stageEnteredAt) ? new Date(String(data.stageEnteredAt)) : now,
    lastCorrectiveActionAt: text(data.lastCorrectiveActionAt) ? new Date(String(data.lastCorrectiveActionAt)) : null,
    implementationRisk: data.implementation_risk,
    closed: data.workflow_stage === "Closed" || data.workflow_stage === "Rejected" || data.status === "Closed",
    noticesSent,
    correctiveActionDueAt: text(data.due_date) ? new Date(String(data.due_date)) : row.dueDate ? new Date(row.dueDate) : null,
    correctiveActionComplete: data.corrective_action_complete === true || data.corrective_action_complete === "Yes",
    ncrType: data.ncr_type,
  });
  if (evaluation.priority) data.priority = data.priority === "Critical" ? "Critical" : evaluation.priority;
  if (evaluation.escalationLevel) data.escalationLevel = evaluation.escalationLevel;
  if (evaluation.notices.some((notice) => notice.dashboardAlert)) {
    data.dashboardAlert = evaluation.notices.find((notice) => notice.dashboardAlert)?.dashboardAlert;
  }
  const stepTargets = Array.isArray(node.config.notify) ? (node.config.notify.filter((item) => typeof item === "string") as string[]) : [];
  const stepKey = `step:${node.id}`;
  const stepNotices: SlaNotice[] = !noticesSent.includes(stepKey) && stepTargets.length > 0
        ? [{ key: stepKey, targets: stepTargets, subject: `${node.label ?? "NCR step"} — NCR ${text(data.ncr_number) || "record"}`, body: `${node.label ?? "This step"} is now active for NCR ${text(data.ncr_number) || "this record"}. This is an in-app notice.` }]
    : [];
  const approverTitles = await managementTitles(db);
  const delivered = await deliverInAppNotices(db, [...stepNotices, ...evaluation.notices], data, approverTitles, row.assignedTo, ncrId);
  data.noticesSent = [...noticesSent, ...delivered];

  await db
    .update(ncr)
    .set({
      workflowStage: typeof data.workflow_stage === "string" ? data.workflow_stage : row.workflowStage,
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
    .where(eq(ncr.id, ncrId));
}

registerActionHandler("ncr_process", (node, context, dryRun) => {
  const runs = Array.isArray(context.actionsRun) ? context.actionsRun : [];
  context.actionsRun = [...runs, { kind: "ncr_process", node: node.id, label: node.label ?? null, simulated: dryRun }];
});

registerWorkflowProgressHook((node, context, dryRun) => {
  const process = node.config?.process;
  if (process !== "ncr" && node.kind !== "ncr_process") return;
  return applyStep(node, context, dryRun);
});
