import { desc, eq } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { AppError } from "../../utils/appError.js";
import { cleanLimitOverrides } from "../records/copyPrevious.js";
import { csaFaiRecords } from "../../drizzle/schema/csaFai.js";
import { workflowDefinitions, workflowRuns } from "../../drizzle/schema/workflow.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { executeWorkflow, type WorkflowDefinition, type WorkflowRunState } from "../workflow/workflow-engine.js";
import { createInitialDraft } from "../versioning/versioning.service.js";
import { workflowAdapter } from "../versioning/adapters.js";
import { CSA_FAI_DEFINITION, csaWorkflowPayload } from "./csaFai.workflow.js";
import {
  CSA_CONTROLLED_VERSION_STATUS,
  CSA_PRODUCT_FAMILY,
  CSA_WORKFLOW_NAME,
  applyBranchResults,
  clockNode,
  emptyState,
  isCsaBranch,
  noteSla,
  readCsa,
  slaForNode,
  stampStep,
  submissionErrors,
  writeCsa,
  type CsaBranch,
  type CsaCriterionResult,
  type CsaState,
} from "./csaFai.logic.js";
import { persistCsa } from "./csaFai.persist.js";
import { CSA_FAI_NUMBER } from "../records/recordNumberSpecs.js";
import { applyRecordNumber, showRecordNumber } from "../records/userRecordNumber.js";
import { requirePlantId } from "../sites/siteAccess.js";
import { loadNcrStatus, notifySla } from "./csaFai.actions.js";

/**
 * The CSA workflow is inserted as a draft only. Publishing stays with Shawn.
 * Opening the canvas must not bootstrap a published version, so the draft row
 * is written in the same step as the definition.
 */
export async function ensureCsaDraft(db: Db, actor: { id: number; roleName: string | null }) {
  const [existing] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.name, CSA_WORKFLOW_NAME)).limit(1);
  if (existing) return existing;
  const payload = csaWorkflowPayload();
  const [created] = await db
    .insert(workflowDefinitions)
    .values({
      name: CSA_WORKFLOW_NAME,
      module: "fai",
      createdBy: actor.id,
      isActive: "false",
      definition: payload as unknown as Record<string, unknown>,
      version: 1,
      versionHistory: [],
    })
    .returning();
  if (!created) throw new AppError("The CSA workflow draft could not be created.", 500);
  if (CSA_CONTROLLED_VERSION_STATUS !== "draft") throw new AppError("The CSA workflow must stay a draft.", 500);
  await createInitialDraft(db, workflowAdapter, created.id, actor, payload as unknown as Record<string, unknown>);
  return created;
}

function present(row: typeof csaFaiRecords.$inferSelect, state: CsaState) {
  return {
    id: row.id,
    number: row.number,
    partNumber: state.partNumber,
    partDescription: state.partDescription,
    supplierName: state.supplierName,
    supplierPartNumber: state.supplierPartNumber,
    sampleLotNumber: state.sampleLotNumber,
    vehicleYear: state.vehicleYear,
    vehicleMake: state.vehicleMake,
    vehicleModel: state.vehicleModel,
    position: state.position,
    inspectorName: state.inspectorName,
    inspectorUserId: state.inspectorUserId,
    openedBy: state.openedBy,
    dateOpened: state.dateOpened,
    status: state.status,
    stage: state.stage,
    productFamily: state.productFamily,
    productionRelease: state.productionRelease,
    approvedSupplier: state.approvedSupplier,
    ncrRequired: state.ncrRequired,
    failureDetected: state.failureDetected,
    ncrId: state.ncrId,
    siteId: state.siteId,
    signatureStamp: state.signatureStamp,
    workflowId: row.workflowId,
    workflowRunId: row.workflowRunId,
    attemptNumber: state.attempt.number,
    locked: state.locked,
    slaStatus: state.slaStatus,
    outcomeLabel: state.outcomeLabel,
    outcomeDisplay: state.outcomeDisplay,
    overallResult: state.overallResult,
    totals: state.attempt.totals,
    attempt: state.attempt,
    history: state.history,
    correctiveAction: state.correctiveAction,
    dampingTestRequired: state.dampingTestRequired,
    vehicleFitmentPerformed: state.vehicleFitmentPerformed,
    limitOverrides: state.limitOverrides,
    report: state.report,
  };
}

async function loadRow(db: Db, id: number) {
  const [row] = await db.select().from(csaFaiRecords).where(eq(csaFaiRecords.id, id));
  if (!row) throw AppError.notFound("CSA first article");
  return row;
}

export async function listCsa(db: Db) {
  const rows = await db.select().from(csaFaiRecords).orderBy(desc(csaFaiRecords.id));
  return rows.map((row) => {
    const state = readCsa((row.packet ?? {}) as Record<string, unknown>);
    return {
      id: row.id,
      number: row.number,
      partNumber: state.partNumber,
      supplierName: state.supplierName,
      status: state.status,
      stage: state.stage,
      productionRelease: state.productionRelease,
      slaStatus: state.slaStatus,
      locked: state.locked,
    };
  });
}

export async function listPreviousCsa(db: Db, partNumber: string) {
  const part = partNumber.trim();
  if (!part) return [];
  return db
    .select({ id: csaFaiRecords.id, number: csaFaiRecords.number, partNumber: csaFaiRecords.partNumber, status: csaFaiRecords.status, supplierName: csaFaiRecords.supplierName })
    .from(csaFaiRecords)
    .where(eq(csaFaiRecords.partNumber, part))
    .orderBy(desc(csaFaiRecords.id))
    .limit(40);
}

/** New CSA record with the previous header and limits. Results, signatures, and history stay on the source. */
export async function copyCsa(db: Db, actor: { id: number; roleName: string | null }, sourceId: number, siteId: number | null) {
  const [row] = await db.select().from(csaFaiRecords).where(eq(csaFaiRecords.id, sourceId));
  if (!row) throw AppError.notFound("CSA first article");
  const state = readCsa((row.packet ?? {}) as Record<string, unknown>);
  return submitCsa(
    db,
    actor,
    {
      partNumber: row.partNumber,
      partDescription: row.partDescription,
      supplierName: row.supplierName,
      supplierId: row.supplierId,
      supplierPartNumber: row.supplierPartNumber,
      sampleLotNumber: row.sampleLotNumber,
      vehicleYear: row.vehicleYear,
      vehicleMake: row.vehicleMake,
      vehicleModel: row.vehicleModel,
      position: row.position,
      inspectorName: row.inspectorName,
      inspectorUserId: row.inspectorUserId,
      dampingTestRequired: state.dampingTestRequired,
      vehicleFitmentPerformed: state.vehicleFitmentPerformed,
      limitOverrides: state.limitOverrides,
    },
    siteId,
  );
}

export async function rememberCsaSla(db: Db, context: Record<string, unknown>, nodeId: string | null) {
  const clock = clockNode(nodeId);
  if (!clock) return;
  let state = stampStep(readCsa(context), nodeId, new Date().toISOString());
  const evaluation = slaForNode(state, clock, new Date().toISOString());
  const noted = noteSla(state, clock, evaluation);
  state = noted.state;
  writeCsa(context, state);
  if (!noted.send) return;
  const kind = evaluation.status === "SLA Escalated" ? "escalated" : evaluation.status === "SLA Overdue" ? "overdue" : "reminder";
  context.__db = db;
  await notifySla(context, kind, `${state.number} ${evaluation.status}`, `${state.number} is at ${evaluation.status}. Due ${evaluation.dueOn ?? "on the assigned date"}.`);
  delete context.__db;
  writeCsa(context, readCsa(context));
}

export async function submitCsa(db: Db, actor: { id: number; roleName: string | null }, input: Record<string, unknown>, siteId: number | null) {
  const plantId = requirePlantId(siteId);
  const errors = submissionErrors(input);
  if (errors.length > 0) throw AppError.badRequest(errors.join(" "));
  const workflow = await ensureCsaDraft(db, actor);
  const now = new Date();
  const numberBody: Record<string, unknown> = { number: input.number };
  await applyRecordNumber(db, numberBody, CSA_FAI_NUMBER);
  const number = showRecordNumber(numberBody.number);
  const state = emptyState(typeof input.dateOpened === "string" && input.dateOpened ? new Date(input.dateOpened).toISOString() : now.toISOString());
  state.number = number;
  state.partNumber = String(input.partNumber).trim();
  state.partDescription = String(input.partDescription).trim();
  state.supplierName = String(input.supplierName).trim();
  state.supplierId = typeof input.supplierId === "number" ? input.supplierId : null;
  state.supplierPartNumber = String(input.supplierPartNumber).trim();
  state.sampleLotNumber = String(input.sampleLotNumber).trim();
  state.vehicleYear = String(input.vehicleYear).trim();
  state.vehicleMake = String(input.vehicleMake).trim();
  state.vehicleModel = String(input.vehicleModel).trim();
  state.position = String(input.position).trim();
  state.inspectorName = String(input.inspectorName).trim();
  state.inspectorUserId = typeof input.inspectorUserId === "number" ? input.inspectorUserId : actor.id;
  state.openedBy = actor.id;
  state.siteId = plantId;
  state.dampingTestRequired = input.dampingTestRequired === true;
  state.vehicleFitmentPerformed = input.vehicleFitmentPerformed === true;
  const overrides = cleanLimitOverrides(input.limitOverrides);
  if (Object.keys(overrides).length > 0) state.limitOverrides = overrides;
  state.status = "Submitted";
  state.stage = "Document Review";
  state.productFamily = CSA_PRODUCT_FAMILY;
  state.productionRelease = "No";

  const [row] = await db
    .insert(csaFaiRecords)
    .values({
      number,
      partNumber: state.partNumber,
      partDescription: state.partDescription,
      supplierName: state.supplierName,
      supplierId: state.supplierId,
      supplierPartNumber: state.supplierPartNumber,
      sampleLotNumber: state.sampleLotNumber,
      vehicleYear: state.vehicleYear,
      vehicleMake: state.vehicleMake,
      vehicleModel: state.vehicleModel,
      position: state.position,
      inspectorName: state.inspectorName,
      inspectorUserId: state.inspectorUserId,
      openedBy: actor.id,
      dateOpened: new Date(state.dateOpened),
      status: state.status,
      stage: state.stage,
      productFamily: state.productFamily,
      productionRelease: "No",
      approvedSupplier: "No",
      ncrRequired: "No",
      failureDetected: "No",
      workflowId: workflow.id,
      siteId: plantId,
      packet: { ...state },
    })
    .returning();
  if (!row) throw new AppError("The CSA first article could not be opened.", 500);
  state.csaFaiId = row.id;

  const context: Record<string, unknown> = { ...state, __db: db, __performedBy: actor.id };
  const execution = await executeWorkflow(workflow.definition as unknown as WorkflowDefinition, context, { triggerKind: "csa_fai_submitted" });
  await rememberCsaSla(db, execution.context, execution.currentNodeId);
  const { __db: _db, __performedBy: _by, ...persistable } = execution.context;
  const waiting = execution.status === "waiting_approval";
  const [run] = await db
    .insert(workflowRuns)
    .values({
      workflowId: workflow.id,
      context: persistable,
      status: waiting ? "waiting_approval" : "completed",
      simulated: false,
      definitionVersion: workflow.version,
      currentNodeId: execution.currentNodeId,
      runState: waiting ? execution.state : null,
      finishedAt: waiting ? null : new Date(),
    })
    .returning();
  const saved = readCsa(execution.context);
  saved.csaFaiId = row.id;
  await db.update(csaFaiRecords).set({ workflowRunId: run?.id ?? null, packet: { ...saved }, updatedAt: new Date() }).where(eq(csaFaiRecords.id, row.id));
  await persistCsa(db, saved);
  await recordAuditTrail(db, {
    entityType: "CsaFai",
    entityId: row.id,
    action: "create",
    changes: { message: "CSA FAI submitted.", number, status: "Submitted", stage: "Document Review" },
    performedBy: actor.id,
  });
  const fresh = await loadRow(db, row.id);
  return { ...present(fresh, readCsa((fresh.packet ?? {}) as Record<string, unknown>)), pendingApproval: (run?.context as { pendingApproval?: unknown } | null)?.pendingApproval ?? null };
}

export async function updateCsaNumber(db: Db, id: number, value: unknown, userId: number) {
  const row = await loadRow(db, id);
  const body: Record<string, unknown> = { number: value };
  const change = await applyRecordNumber(db, body, CSA_FAI_NUMBER, { id, current: row.number, row });
  const stored = typeof body.number === "string" ? body.number : null;
  const packet = { ...((row.packet ?? {}) as Record<string, unknown>), number: stored ?? "" };
  await db.update(csaFaiRecords).set({ number: stored, packet, updatedAt: new Date() }).where(eq(csaFaiRecords.id, id));
  if (change) await recordAuditTrail(db, { entityType: "CsaFai", entityId: id, action: "update", changes: change, performedBy: userId });
  return getCsa(db, id);
}

export async function getCsa(db: Db, id: number) {
  const row = await loadRow(db, id);
  const state = readCsa((row.packet ?? {}) as Record<string, unknown>);
  let pending: unknown = null;
  if (row.workflowRunId) {
    const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, row.workflowRunId));
    pending = (run?.context as { pendingApproval?: unknown } | null)?.pendingApproval ?? null;
    if (run && state.locked !== "Yes") {
      const context = { ...(run.context as Record<string, unknown>), __db: db };
      if (state.ncrId) {
        const status = await loadNcrStatus(db, state.ncrId);
        writeCsa(context, { ...readCsa(context), ncrStatus: status });
      }
      await rememberCsaSla(db, context, run.currentNodeId);
      const { __db: _db, ...persistable } = context;
      await db.update(workflowRuns).set({ context: persistable }).where(eq(workflowRuns.id, run.id));
      await persistCsa(db, readCsa(context));
    }
  }
  const fresh = await loadRow(db, id);
  return { ...present(fresh, readCsa((fresh.packet ?? {}) as Record<string, unknown>)), pendingApproval: pending };
}

export async function saveCsaResults(db: Db, id: number, branch: string, entries: Partial<CsaCriterionResult>[]) {
  if (!isCsaBranch(branch)) throw AppError.badRequest("That inspection branch is not on this workflow.");
  const row = await loadRow(db, id);
  if (row.locked === "Yes") throw AppError.badRequest("This CSA FAI is locked.");
  if (!row.workflowRunId) throw AppError.badRequest("This CSA FAI has no workflow run.");
  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, row.workflowRunId));
  if (!run?.context) throw AppError.badRequest("This CSA FAI has no workflow run.");
  const context = { ...(run.context as Record<string, unknown>) };
  const applied = applyBranchResults(readCsa(context), branch as CsaBranch, entries);
  if (applied.errors.length > 0) throw AppError.badRequest(applied.errors.join(" "));
  writeCsa(context, applied.state);
  await db.update(workflowRuns).set({ context }).where(eq(workflowRuns.id, run.id));
  await persistCsa(db, applied.state);
  return present(await loadRow(db, id), applied.state);
}

export function csaDefinition(): WorkflowDefinition {
  return CSA_FAI_DEFINITION;
}

export type CsaRunState = WorkflowRunState;
