import { eq } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { registerActionHandler, type WorkflowNode } from "../workflow/workflow-engine.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import {
  FPM_NODE,
  archiveState,
  assertCanRelease,
  beginAttempt,
  buildReport,
  calculateInspection,
  hasCriticalFailure,
  ncrDescription,
  readFpm,
  readyField,
  rejectFai,
  writeFpm,
  isFpmBranch,
  type FpmSlaStatus,
  type FpmState,
  type SlaEvaluation,
} from "./fuelPumpFai.logic.js";
import { emailForUser, emailsForAssigneeLabel, emailsForDepartment, notifyInApp, persistFpm } from "./fuelPumpFai.persist.js";

function dbOf(context: Record<string, unknown>): Db | undefined {
  return context.__db as Db | undefined;
}

function actorId(context: Record<string, unknown>): number | undefined {
  return typeof context.__performedBy === "number" ? context.__performedBy : undefined;
}

async function save(context: Record<string, unknown>, state: FpmState): Promise<void> {
  writeFpm(context, state);
  const db = dbOf(context);
  if (db) await persistFpm(db, state);
}

function finalApprovalRecorded(context: Record<string, unknown>, dryRun: boolean, state: FpmState): boolean {
  if (state.finalQualityApproval) return true;
  if (!dryRun) return false;
  const steps = context.steps as { node?: string; result?: string }[] | undefined;
  return steps?.some((step) => step.node === FPM_NODE.finalApproval && step.result === "simulated: approved") ?? false;
}

function engineeringCleared(context: Record<string, unknown>, dryRun: boolean, state: FpmState): boolean {
  if (state.engineeringAccepted) return true;
  if (!dryRun) return false;
  const steps = context.steps as { node?: string; result?: string }[] | undefined;
  return steps?.some((step) => step.node === FPM_NODE.engineering && step.result === "simulated: approved") ?? false;
}

async function notifyEmails(context: Record<string, unknown>, emails: string[], subject: string, body: string, targets: string[]): Promise<void> {
  const db = dbOf(context);
  const state = readFpm(context);
  if (!db) {
    context.notices = [...((context.notices as unknown[]) ?? []), { subject, recipients: emails.length, channel: "in_app", targets }];
    return;
  }
  const count = await notifyInApp(db, emails, subject, body, state.fuelPumpFaiId);
  context.notices = [...((context.notices as unknown[]) ?? []), { subject, recipients: count, channel: "in_app", targets }];
}

async function noteFailure(_node: WorkflowNode, context: Record<string, unknown>, state: FpmState, dryRun: boolean, reason: "failure" | "critical"): Promise<FpmState> {
  const description = ncrDescription(state);
  const critical = reason === "critical" || hasCriticalFailure(state);
  let next: FpmState = {
    ...state,
    ncrRequired: state.ncrId ? "Yes" : "No",
    productionRelease: "No",
    failureDetected: "Yes",
    correctiveActionReady: false,
    status: state.status === "Rejected" ? state.status : "Failed",
    stage: "NCR and Corrective Action",
  };
  if (dryRun) {
    context.actionsRun = [...((context.actionsRun as unknown[]) ?? []), { kind: "fpm_create_ncr", simulated: true, description, critical, created: false }];
  }
  const db = dbOf(context);
  if (!dryRun && next.ncrId && db) {
    await recordAuditTrail(db, {
      entityType: "NCR",
      entityId: next.ncrId,
      action: "update",
      changes: { message: "Another fuel pump FAI attempt was linked to this NCR.", faiNumber: state.number, attempt: state.attempt.number, description },
      performedBy: actorId(context),
    });
  }
  if (critical && !next.criticalNoticeSent) {
    const emails: string[] = [];
    if (db) {
      emails.push(...(await emailsForAssigneeLabel(db, "Quality Manager")));
      emails.push(...(await emailsForAssigneeLabel(db, "Engineering Manager")));
    }
    await notifyEmails(context, emails, `${state.number} critical failure`, `${state.number} has a critical failure. Production release is blocked.`, ["Quality Manager", "Engineering Manager"]);
    next = { ...next, criticalNoticeSent: true };
  }
  return next;
}

registerActionHandler("fpm_apply_correction", async (_node, context) => {
  const state = readFpm(context);
  await save(context, { ...state, stage: state.correctionReady ? "Document Review" : "Correct FAI Information", status: "Submitted" });
});

registerActionHandler("fpm_reject", async (_node, context) => {
  await save(context, rejectFai(readFpm(context), new Date().toISOString()));
});

registerActionHandler("fpm_inspect", async (node, context, dryRun) => {
  const state = readFpm(context);
  const branch = typeof node.config.branch === "string" && isFpmBranch(node.config.branch) ? node.config.branch : null;
  const ready = branch ? state[readyField(branch)] === true : false;
  if (!ready) {
    await save(context, { ...state, stage: "Fuel Pump Validation Testing" });
    return;
  }
  let next: FpmState = { ...state, stage: "Fuel Pump Validation Testing" };
  if (hasCriticalFailure(next)) next = await noteFailure(node, context, next, dryRun, "critical");
  await save(context, next);
});

registerActionHandler("fpm_calculate", async (_node, context) => {
  await save(context, calculateInspection(readFpm(context)));
});

registerActionHandler("fpm_open_attempt", async (_node, context) => {
  await save(context, beginAttempt(readFpm(context), new Date().toISOString()));
});

registerActionHandler("fpm_create_ncr", async (node, context, dryRun) => {
  await save(context, await noteFailure(node, context, readFpm(context), dryRun, "failure"));
});

registerActionHandler("fpm_corrective_action", async (_node, context) => {
  const state = readFpm(context);
  await save(context, { ...state, stage: state.correctiveActionReady ? "Retest Approval" : "Corrective Action", status: "Failed" });
});

registerActionHandler("fpm_release", async (node: WorkflowNode, context, dryRun) => {
  const state = readFpm(context);
  assertCanRelease(state, {
    finalApprovalRecorded: finalApprovalRecorded(context, dryRun, state),
    engineeringCleared: engineeringCleared(context, dryRun, state),
  });
  const now = new Date().toISOString();
  const released: FpmState = {
    ...state,
    status: "Approved",
    stage: "Production Release",
    productionRelease: "Yes",
    approvalDate: now,
    approvedBy: actorId(context) ?? state.approvedBy,
  };
  released.report = buildReport(released);
  await save(context, released);
  const groups = Array.isArray(node.config.notify) ? (node.config.notify as { label?: string; department?: string; assignee?: string }[]) : [];
  const db = dbOf(context);
  const emails: string[] = [];
  const targets: string[] = [];
  if (db) {
    for (const group of groups) {
      if (group.label) targets.push(group.label);
      if (group.department) emails.push(...(await emailsForDepartment(db, group.department)));
      if (group.assignee) emails.push(...(await emailsForAssigneeLabel(db, group.assignee)));
    }
  } else {
    for (const group of groups) if (group.label) targets.push(group.label);
  }
  await notifyEmails(context, emails, `${released.number} is approved for production`, `${released.number} ${released.partNumber} from ${released.supplier} is approved for production.`, targets);
});

registerActionHandler("fpm_archive", async (_node, context) => {
  const state = archiveState(readFpm(context), new Date().toISOString());
  await save(context, state);
  const db = dbOf(context);
  if (db && state.fuelPumpFaiId) {
    await recordAuditTrail(db, {
      entityType: "FuelPumpFai",
      entityId: state.fuelPumpFaiId,
      action: "status_change",
      changes: { message: "Fuel pump FAI archived and locked.", status: "Closed" },
      performedBy: actorId(context),
    });
  }
});

export async function notifySla(context: Record<string, unknown>, evaluation: SlaEvaluation, subject: string, body: string): Promise<void> {
  const state = readFpm(context);
  const db = dbOf(context);
  const emails: string[] = [];
  const targets: string[] = [];
  if (evaluation.notifyOwner) {
    targets.push("assigned owner");
    if (db) {
      const owner = await emailForUser(db, state.correctiveOwnerId ?? state.inspectorUserId ?? state.openedBy);
      if (owner) emails.push(owner);
    }
  }
  if (evaluation.notifyQualityManager) {
    targets.push("Quality Manager");
    if (db) emails.push(...(await emailsForAssigneeLabel(db, "Quality Manager")));
  }
  if (evaluation.notifyOperationsManager) {
    targets.push("Operations Manager");
    if (db) emails.push(...(await emailsForAssigneeLabel(db, "Operations Manager")));
  }
  await notifyEmails(context, emails, subject, body, targets);
}

export async function loadNcrStatus(db: Db, ncrId: number | null): Promise<string | null> {
  if (ncrId == null) return null;
  const [row] = await db.select({ status: ncr.status }).from(ncr).where(eq(ncr.id, ncrId));
  return row?.status ?? null;
}

export type { FpmSlaStatus };
