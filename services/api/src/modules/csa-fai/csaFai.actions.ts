import { eq } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { registerActionHandler, type WorkflowNode } from "../workflow/workflow-engine.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import {
  CSA_NODE,
  archiveState,
  assertCanRelease,
  beginAttempt,
  buildReport,
  calculateInspection,
  ncrDescription,
  readCsa,
  rejectFai,
  writeCsa,
  type CsaState,
} from "./csaFai.logic.js";
import { emailForUser, emailsForAssigneeLabel, emailsForDepartment, notifyInApp, persistCsa } from "./csaFai.persist.js";

function dbOf(context: Record<string, unknown>): Db | undefined {
  return context.__db as Db | undefined;
}

function actorId(context: Record<string, unknown>): number | undefined {
  return typeof context.__performedBy === "number" ? context.__performedBy : undefined;
}

async function save(context: Record<string, unknown>, state: CsaState): Promise<void> {
  writeCsa(context, state);
  const db = dbOf(context);
  if (db) await persistCsa(db, state);
}

function finalApprovalRecorded(context: Record<string, unknown>, dryRun: boolean, state: CsaState): boolean {
  if (state.finalQualityApproval) return true;
  if (!dryRun) return false;
  const steps = context.steps as { node?: string; result?: string }[] | undefined;
  return steps?.some((step) => step.node === CSA_NODE.finalApproval && step.result === "simulated: approved") ?? false;
}

function engineeringCleared(context: Record<string, unknown>, dryRun: boolean, state: CsaState): boolean {
  if (state.engineeringAccepted) return true;
  if (!dryRun) return false;
  const steps = context.steps as { node?: string; result?: string }[] | undefined;
  return steps?.some((step) => step.node === CSA_NODE.engineering && step.result === "simulated: approved") ?? false;
}

async function notifyEmails(context: Record<string, unknown>, emails: string[], subject: string, body: string): Promise<void> {
  const db = dbOf(context);
  const state = readCsa(context);
  if (!db) {
    context.notices = [...((context.notices as unknown[]) ?? []), { subject, recipients: emails.length, channel: "in_app" }];
    return;
  }
  const count = await notifyInApp(db, emails, subject, body, state.csaFaiId);
  context.notices = [...((context.notices as unknown[]) ?? []), { subject, recipients: count, channel: "in_app" }];
}

registerActionHandler("csa_apply_correction", async (_node, context) => {
  const state = readCsa(context);
  await save(context, { ...state, stage: state.correctionReady ? "Document Review" : "Correct FAI Information", status: "Submitted" });
});

registerActionHandler("csa_reject", async (_node, context) => {
  const state = rejectFai(readCsa(context), new Date().toISOString());
  await save(context, state);
});

registerActionHandler("csa_branch_finished", async (node, context) => {
  const state = readCsa(context);
  const branch = typeof node.config.branch === "string" ? node.config.branch : "";
  context.branchesFinished = [...new Set([...((context.branchesFinished as string[]) ?? []), branch])];
  await save(context, { ...state, stage: "Perform CSA Inspection" });
});

registerActionHandler("csa_calculate", async (_node, context) => {
  const state = calculateInspection(readCsa(context));
  await save(context, state);
  if (state.engineeringNoticePending) {
    const db = dbOf(context);
    const emails = db ? await emailsForDepartment(db, "engineering") : [];
    await notifyEmails(context, emails, `${state.number} needs engineering review`, `${state.number} has a measurement with no acceptance limit. Final approval is blocked until Engineering accepts it or defines the requirement.`);
  }
});

registerActionHandler("csa_open_attempt", async (_node, context) => {
  await save(context, beginAttempt(readCsa(context), new Date().toISOString()));
});

registerActionHandler("csa_create_ncr", async (_node, context, dryRun) => {
  const state = readCsa(context);
  const description = ncrDescription(state);
  if (dryRun) {
    context.actionsRun = [...((context.actionsRun as unknown[]) ?? []), { kind: "csa_create_ncr", simulated: true, description, created: false }];
  }
  const db = dbOf(context);
  if (!dryRun && state.ncrId && db) {
    await recordAuditTrail(db, {
      entityType: "NCR",
      entityId: state.ncrId,
      action: "update",
      changes: { message: "Another CSA FAI attempt was linked to this NCR.", faiNumber: state.number, attempt: state.attempt.number, description },
      performedBy: actorId(context),
    });
  }
  await save(context, {
    ...state,
    ncrRequired: state.ncrId ? "Yes" : "No",
    productionRelease: "No",
    failureDetected: "Yes",
    status: "Failed",
    stage: "NCR and Corrective Action",
  });
});

registerActionHandler("csa_corrective_action", async (_node, context) => {
  const state = readCsa(context);
  await save(context, { ...state, stage: state.correctiveActionReady ? "Retest Approval" : "Corrective Action", status: "Failed" });
});

registerActionHandler("csa_release", async (node: WorkflowNode, context, dryRun) => {
  const state = readCsa(context);
  assertCanRelease(state, {
    finalApprovalRecorded: finalApprovalRecorded(context, dryRun, state),
    engineeringCleared: engineeringCleared(context, dryRun, state),
  });
  const now = new Date().toISOString();
  const released: CsaState = {
    ...state,
    status: "Approved",
    stage: "Production Release",
    productionRelease: "Yes",
    approvedSupplier: "Yes",
    approvalDate: now,
    approvedBy: actorId(context) ?? state.approvedBy,
  };
  released.report = buildReport(released);
  await save(context, released);
  const groups = Array.isArray(node.config.notify) ? (node.config.notify as { label?: string; department?: string; assignee?: string }[]) : [];
  const db = dbOf(context);
  const emails: string[] = [];
  if (db) {
    for (const group of groups) {
      if (group.department) emails.push(...(await emailsForDepartment(db, group.department)));
      if (group.assignee) emails.push(...(await emailsForAssigneeLabel(db, group.assignee)));
    }
  }
  await notifyEmails(context, emails, `${released.number} is approved for production`, `${released.number} ${released.partNumber} from ${released.supplierName} is approved for production.`);
});

registerActionHandler("csa_archive", async (_node, context) => {
  const state = archiveState(readCsa(context), new Date().toISOString());
  await save(context, state);
  const db = dbOf(context);
  if (db && state.csaFaiId) {
    await recordAuditTrail(db, {
      entityType: "CsaFai",
      entityId: state.csaFaiId,
      action: "status_change",
      changes: { message: "CSA FAI archived and locked.", status: "Closed" },
      performedBy: actorId(context),
    });
  }
});

export async function notifySla(context: Record<string, unknown>, kind: "reminder" | "overdue" | "escalated", subject: string, body: string): Promise<void> {
  const state = readCsa(context);
  const db = dbOf(context);
  const emails: string[] = [];
  if (db) {
    const owner = await emailForUser(db, state.correctiveOwnerId ?? state.inspectorUserId ?? state.openedBy);
    if (owner) emails.push(owner);
    if (kind !== "reminder") emails.push(...(await emailsForAssigneeLabel(db, "Quality Manager")));
    if (kind === "escalated") emails.push(...(await emailsForAssigneeLabel(db, "Operations Manager")));
  }
  await notifyEmails(context, emails, subject, body);
}

export async function loadNcrStatus(db: Db, ncrId: number | null): Promise<string | null> {
  if (ncrId == null) return null;
  const [row] = await db.select({ status: ncr.status }).from(ncr).where(eq(ncr.id, ncrId));
  return row?.status ?? null;
}
