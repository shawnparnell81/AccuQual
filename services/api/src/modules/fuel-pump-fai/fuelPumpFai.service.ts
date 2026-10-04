import { desc, eq } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { AppError } from "../../utils/appError.js";
import { cleanLimitOverrides } from "../records/copyPrevious.js";
import { fuelPumpFaiRecords } from "../../drizzle/schema/fuelPumpFai.js";
import { workflowDefinitions, workflowRuns } from "../../drizzle/schema/workflow.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { executeWorkflow, type WorkflowDefinition, type WorkflowRunState } from "../workflow/workflow-engine.js";
import { createInitialDraft } from "../versioning/versioning.service.js";
import { workflowAdapter } from "../versioning/adapters.js";
import { FPM_FAI_DEFINITION, fuelPumpWorkflowPayload } from "./fuelPumpFai.workflow.js";
import {
  FPM_CONTROLLED_VERSION_STATUS,
  FPM_PRODUCT_FAMILY,
  FPM_WORKFLOW_NAME,
  applyBranchResults,
  clockNode,
  emptyState,
  evaluateOverallSla,
  isFpmBranch,
  noteSla,
  readFpm,
  slaForNode,
  stampStep,
  submissionErrors,
  worseSla,
  writeFpm,
  type FpmBranch,
  type FpmCriterionResult,
  type FpmState,
} from "./fuelPumpFai.logic.js";
import { nextFuelPumpNumber, persistFpm } from "./fuelPumpFai.persist.js";
import { requirePlantId } from "../sites/siteAccess.js";
import { loadNcrStatus, notifySla } from "./fuelPumpFai.actions.js";

/**
 * The fuel pump workflow is inserted as a draft only. Publishing stays with Shawn.
 * Opening the canvas must not bootstrap a published version, so the draft row
 * is written in the same step as the definition.
 */
export async function ensureFuelPumpDraft(db: Db, actor: { id: number; roleName: string | null }) {
  const [existing] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.name, FPM_WORKFLOW_NAME)).limit(1);
  if (existing) return existing;
  const payload = fuelPumpWorkflowPayload();
  const [created] = await db
    .insert(workflowDefinitions)
    .values({
      name: FPM_WORKFLOW_NAME,
      module: "fai",
      createdBy: actor.id,
      isActive: "false",
      definition: payload as unknown as Record<string, unknown>,
      version: 1,
      versionHistory: [],
    })
    .returning();
  if (!created) throw new AppError("The fuel pump workflow draft could not be created.", 500);
  if (FPM_CONTROLLED_VERSION_STATUS !== "draft") throw new AppError("The fuel pump workflow must stay a draft.", 500);
  await createInitialDraft(db, workflowAdapter, created.id, actor, payload as unknown as Record<string, unknown>);
  return created;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function present(row: typeof fuelPumpFaiRecords.$inferSelect, state: FpmState) {
  return {
    id: row.id,
    number: row.faiNumber,
    partNumber: state.partNumber,
    partDescription: state.partDescription,
    supplier: state.supplier,
    supplierPartNumber: state.supplierPartNumber,
    sampleLotNumber: state.sampleLotNumber,
    vehicleYear: state.vehicleYear,
    vehicleMake: state.vehicleMake,
    vehicleModel: state.vehicleModel,
    vehicleEngine: state.vehicleEngine,
    application: state.application,
    inspector: state.inspector,
    inspectorUserId: state.inspectorUserId,
    validationOwner: state.validationOwner,
    qualityManager: state.qualityManager,
    openedBy: state.openedBy,
    dateOpened: state.dateOpened,
    status: state.status,
    stage: state.stage,
    productFamily: state.productFamily,
    productionRelease: state.productionRelease,
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
    flowRateResult: state.flowRateResult,
    pressureResult: state.pressureResult,
    currentDrawResult: state.currentDrawResult,
    electricalResult: state.electricalResult,
    fitmentResult: state.fitmentResult,
    packagingResult: state.packagingResult,
    totals: state.attempt.totals,
    attempt: state.attempt,
    history: state.history,
    correctiveAction: state.correctiveAction,
    limitOverrides: state.limitOverrides,
    report: state.report,
  };
}

async function loadRow(db: Db, id: number) {
  const [row] = await db.select().from(fuelPumpFaiRecords).where(eq(fuelPumpFaiRecords.id, id));
  if (!row) throw AppError.notFound("Fuel pump first article");
  return row;
}

export async function listFuelPump(db: Db) {
  const rows = await db.select().from(fuelPumpFaiRecords).orderBy(desc(fuelPumpFaiRecords.id));
  return rows.map((row) => {
    const state = readFpm((row.packet ?? {}) as Record<string, unknown>);
    return {
      id: row.id,
      number: row.faiNumber,
      partNumber: state.partNumber,
      supplier: state.supplier,
      status: state.status,
      stage: state.stage,
      productionRelease: state.productionRelease,
      slaStatus: state.slaStatus,
      locked: state.locked,
    };
  });
}

export async function listPreviousFuelPump(db: Db, partNumber: string) {
  const part = partNumber.trim();
  if (!part) return [];
  return db
    .select({ id: fuelPumpFaiRecords.id, number: fuelPumpFaiRecords.faiNumber, partNumber: fuelPumpFaiRecords.partNumber, status: fuelPumpFaiRecords.status, supplierName: fuelPumpFaiRecords.supplier })
    .from(fuelPumpFaiRecords)
    .where(eq(fuelPumpFaiRecords.partNumber, part))
    .orderBy(desc(fuelPumpFaiRecords.id))
    .limit(40);
}

/** New fuel-pump record with the previous header and limits. Results, signatures, and history stay on the source. */
export async function copyFuelPump(db: Db, actor: { id: number; roleName: string | null }, sourceId: number, siteId: number | null) {
  const [row] = await db.select().from(fuelPumpFaiRecords).where(eq(fuelPumpFaiRecords.id, sourceId));
  if (!row) throw AppError.notFound("Fuel pump first article");
  const state = readFpm((row.packet ?? {}) as Record<string, unknown>);
  return submitFuelPump(
    db,
    actor,
    {
      partNumber: row.partNumber,
      partDescription: row.partDescription,
      supplier: row.supplier,
      supplierId: row.supplierId,
      supplierPartNumber: row.supplierPartNumber,
      sampleLotNumber: row.sampleLotNumber,
      vehicleYear: row.vehicleYear,
      vehicleMake: row.vehicleMake,
      vehicleModel: row.vehicleModel,
      vehicleEngine: row.vehicleEngine,
      application: row.application,
      inspector: row.inspector,
      inspectorUserId: row.inspectorUserId,
      validationOwner: row.validationOwner,
      qualityManager: row.qualityManager,
      limitOverrides: state.limitOverrides,
    },
    siteId,
  );
}

export async function rememberFuelPumpSla(db: Db, context: Record<string, unknown>, nodeId: string | null) {
  const clock = clockNode(nodeId);
  let state = readFpm(context);
  if (clock) state = stampStep(state, nodeId, new Date().toISOString());
  const now = new Date().toISOString();
  const stepEvaluation = clock ? slaForNode(state, clock, now) : { status: "Not started" as const, dueOn: null, overdueDays: 0, notifyOwner: false, notifyQualityManager: false, notifyOperationsManager: false };
  const evaluation = worseSla(stepEvaluation, evaluateOverallSla(state.dateOpened, now));
  const noted = noteSla(state, clock ?? "overall", evaluation);
  state = noted.state;
  writeFpm(context, state);
  if (!noted.send) return;
  context.__db = db;
  await notifySla(context, evaluation, `${state.number} ${evaluation.status}`, `${state.number} is ${evaluation.status}. Due ${evaluation.dueOn ?? "on the assigned date"}.`);
  delete context.__db;
  writeFpm(context, readFpm(context));
}

export async function submitFuelPump(db: Db, actor: { id: number; roleName: string | null }, input: Record<string, unknown>, siteId: number | null) {
  const plantId = requirePlantId(siteId);
  const application = text(input.application) || text(input.vehicleApplication);
  const supplier = text(input.supplier) || text(input.supplierName);
  const inspector = text(input.inspector) || text(input.inspectorName);
  const normalized = { ...input, application, supplier, inspector };
  const errors = submissionErrors(normalized);
  if (errors.length > 0) throw AppError.badRequest(errors.join(" "));
  const workflow = await ensureFuelPumpDraft(db, actor);
  const now = new Date();
  const number = await nextFuelPumpNumber(db, now.getUTCFullYear());
  const state = emptyState(typeof input.dateOpened === "string" && input.dateOpened ? new Date(input.dateOpened).toISOString() : now.toISOString());
  state.number = number;
  state.partNumber = text(input.partNumber);
  state.partDescription = text(input.partDescription);
  state.supplier = supplier;
  state.supplierId = typeof input.supplierId === "number" ? input.supplierId : null;
  state.supplierPartNumber = text(input.supplierPartNumber);
  state.sampleLotNumber = text(input.sampleLotNumber);
  state.vehicleYear = text(input.vehicleYear);
  state.vehicleMake = text(input.vehicleMake);
  state.vehicleModel = text(input.vehicleModel);
  state.vehicleEngine = text(input.vehicleEngine);
  state.application = application;
  state.inspector = inspector;
  state.inspectorUserId = typeof input.inspectorUserId === "number" ? input.inspectorUserId : actor.id;
  state.validationOwner = text(input.validationOwner);
  state.qualityManager = text(input.qualityManager);
  state.openedBy = actor.id;
  state.siteId = plantId;
  state.status = "Submitted";
  state.stage = "Document Review";
  state.productFamily = FPM_PRODUCT_FAMILY;
  state.productionRelease = "No";
  const overrides = cleanLimitOverrides(input.limitOverrides);
  if (Object.keys(overrides).length > 0) state.limitOverrides = overrides;

  const [row] = await db
    .insert(fuelPumpFaiRecords)
    .values({
      faiNumber: number,
      partNumber: state.partNumber,
      partDescription: state.partDescription,
      supplier: state.supplier,
      supplierId: state.supplierId,
      supplierPartNumber: state.supplierPartNumber,
      sampleLotNumber: state.sampleLotNumber,
      vehicleYear: state.vehicleYear,
      vehicleMake: state.vehicleMake,
      vehicleModel: state.vehicleModel,
      vehicleEngine: state.vehicleEngine,
      application: state.application,
      inspector: state.inspector,
      inspectorUserId: state.inspectorUserId,
      validationOwner: state.validationOwner,
      qualityManager: state.qualityManager,
      openedBy: actor.id,
      dateOpened: new Date(state.dateOpened),
      status: state.status,
      workflowStage: state.stage,
      productionRelease: "No",
      ncrRequired: "No",
      failureDetected: "No",
      workflowId: workflow.id,
      siteId: plantId,
      packet: { ...state },
    })
    .returning();
  if (!row) throw new AppError("The fuel pump first article could not be opened.", 500);
  state.fuelPumpFaiId = row.id;

  const context: Record<string, unknown> = { ...state, __db: db, __performedBy: actor.id };
  const execution = await executeWorkflow(workflow.definition as unknown as WorkflowDefinition, context, { triggerKind: "fpm_fai_submitted" });
  await rememberFuelPumpSla(db, execution.context, execution.currentNodeId);
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
  const saved = readFpm(execution.context);
  saved.fuelPumpFaiId = row.id;
  await db.update(fuelPumpFaiRecords).set({ workflowRunId: run?.id ?? null, packet: { ...saved }, updatedAt: new Date() }).where(eq(fuelPumpFaiRecords.id, row.id));
  await persistFpm(db, saved);
  await recordAuditTrail(db, {
    entityType: "FuelPumpFai",
    entityId: row.id,
    action: "create",
    changes: { message: "Fuel pump FAI submitted.", number, status: "Submitted", stage: "Document Review" },
    performedBy: actor.id,
  });
  const fresh = await loadRow(db, row.id);
  return { ...present(fresh, readFpm((fresh.packet ?? {}) as Record<string, unknown>)), pendingApproval: (run?.context as { pendingApproval?: unknown } | null)?.pendingApproval ?? null };
}

export async function getFuelPump(db: Db, id: number) {
  const row = await loadRow(db, id);
  const state = readFpm((row.packet ?? {}) as Record<string, unknown>);
  let pending: unknown = null;
  if (row.workflowRunId) {
    const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, row.workflowRunId));
    pending = (run?.context as { pendingApproval?: unknown } | null)?.pendingApproval ?? null;
    if (run && state.locked !== "Yes") {
      const context = { ...(run.context as Record<string, unknown>), __db: db };
      if (state.ncrId) {
        const status = await loadNcrStatus(db, state.ncrId);
        writeFpm(context, { ...readFpm(context), ncrStatus: status });
      }
      await rememberFuelPumpSla(db, context, run.currentNodeId);
      const { __db: _db, ...persistable } = context;
      await db.update(workflowRuns).set({ context: persistable }).where(eq(workflowRuns.id, run.id));
      await persistFpm(db, readFpm(context));
    }
  }
  const fresh = await loadRow(db, id);
  return { ...present(fresh, readFpm((fresh.packet ?? {}) as Record<string, unknown>)), pendingApproval: pending };
}

export async function saveFuelPumpResults(db: Db, id: number, branch: string, entries: Partial<FpmCriterionResult>[]) {
  if (!isFpmBranch(branch)) throw AppError.badRequest("That inspection branch is not on this workflow.");
  const row = await loadRow(db, id);
  if (row.locked === "Yes") throw AppError.badRequest("This fuel pump FAI is locked.");
  if (!row.workflowRunId) throw AppError.badRequest("This fuel pump FAI has no workflow run.");
  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, row.workflowRunId));
  if (!run?.context) throw AppError.badRequest("This fuel pump FAI has no workflow run.");
  const context = { ...(run.context as Record<string, unknown>) };
  const applied = applyBranchResults(readFpm(context), branch as FpmBranch, entries);
  if (applied.errors.length > 0) throw AppError.badRequest(applied.errors.join(" "));
  writeFpm(context, applied.state);
  await db.update(workflowRuns).set({ context }).where(eq(workflowRuns.id, run.id));
  await persistFpm(db, applied.state);
  return present(await loadRow(db, id), applied.state);
}

export function fuelPumpDefinition(): WorkflowDefinition {
  return FPM_FAI_DEFINITION;
}

export type FuelPumpRunState = WorkflowRunState;
