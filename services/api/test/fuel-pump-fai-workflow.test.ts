import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { executeWorkflow, resumeWorkflow, type WorkflowExecutionResult } from "../src/modules/workflow/workflow-engine.js";
import { validateWorkflow } from "../src/modules/workflow/workflow-graph.js";
import { WORKFLOW_TEMPLATES } from "../src/modules/workflow/workflow.templates.js";
import { FPM_FAI_DEFINITION, FPM_FAI_METADATA } from "../src/modules/fuel-pump-fai/fuelPumpFai.workflow.js";
import {
  FPM_CONTROLLED_VERSION_STATUS,
  FPM_CRITERIA,
  FPM_NODE,
  FPM_NUMBER_PREFIX,
  addBusinessDays,
  addCalendarDays,
  assertCanRelease,
  businessDaysAfter,
  emptyState,
  judgeCriterion,
  evaluateOverallSla,
  evaluateSla,
  prepareFpmDecision,
  readFpm,
  seedResults,
  userMatchesAssignees,
  writeFpm,
  type FpmCriterion,
  type FpmState,
} from "../src/modules/fuel-pump-fai/fuelPumpFai.logic.js";
import "../src/modules/fuel-pump-fai/fuelPumpFai.actions.js";

const ALLOWED = new Set(["trigger", "condition", "action", "approval", "parallel", "end"]);

function contextFrom(state: FpmState): Record<string, unknown> {
  return { ...state, number: state.number || `${FPM_NUMBER_PREFIX}-2026-000001` };
}

interface Choice {
  decision: string;
  notes?: string;
  details?: Record<string, unknown>;
  seed?: "pass" | "fail";
}

async function walk(start: FpmState, choose: (pending: { nodeId?: string; pauseUntil?: string; branch?: string }, state: FpmState) => Choice | "stop"): Promise<WorkflowExecutionResult> {
  let execution = await executeWorkflow(FPM_FAI_DEFINITION, contextFrom(start), { triggerKind: "fpm_fai_submitted" });
  for (let guard = 0; guard < 40 && execution.status === "waiting_approval"; guard += 1) {
    const pending = execution.context.pendingApproval as { nodeId?: string; pauseUntil?: string; workflowKey?: string; branch?: string };
    const choice = choose(pending, readFpm(execution.context));
    if (choice === "stop") return execution;
    if (choice.seed) {
      const seeded = seedResults(readFpm(execution.context), choice.seed === "fail"
        ? (criterion, entry) => criterion.key === "no_cracks" ? { ...entry, result: "Fail", comments: "Crack in the housing", photos: [{ fileName: "crack.jpg" }] } : entry
        : undefined);
      writeFpm(execution.context, { ...seeded, visualReady: false, dimensionalReady: false, electricalReady: false, functionalReady: false, fitmentReady: false, packagingReady: false });
    }
    const patch = prepareFpmDecision(pending, choice.decision, choice.notes, choice.details, execution.context);
    writeFpm(execution.context, { ...readFpm(execution.context), ...patch });
    if (!execution.state) throw new Error("The run is waiting without a saved position.");
    execution = await resumeWorkflow(FPM_FAI_DEFINITION, execution.state, execution.context, choice.decision);
  }
  return execution;
}

const approve: Choice = { decision: "approved", notes: "Reviewed." };
const corrective: Choice = {
  decision: "approved",
  notes: "Corrected",
  details: { rootCause: "Housing crack", correctiveAction: "Replace the housing", responsiblePerson: "Quality Engineer", dueDate: "2026-10-20" },
};

describe("Fuel Pump Module FAI workflow", () => {
  it("uses the existing node types and is a valid looping draft", () => {
    expect(FPM_FAI_DEFINITION.nodes.every((node) => ALLOWED.has(node.type))).toBe(true);
    expect(FPM_FAI_DEFINITION.nodes.some((node) => node.type === "integration")).toBe(false);
    expect(FPM_CRITERIA.filter((row) => row.branch === "visual")).toHaveLength(9);
    expect(FPM_CRITERIA.filter((row) => row.branch === "dimensional")).toHaveLength(6);
    expect(FPM_CRITERIA.filter((row) => row.branch === "electrical")).toHaveLength(5);
    expect(FPM_CRITERIA.filter((row) => row.branch === "functional")).toHaveLength(9);
    expect(FPM_CRITERIA.filter((row) => row.branch === "fitment")).toHaveLength(6);
    expect(FPM_CRITERIA.filter((row) => row.branch === "packaging")).toHaveLength(6);
    const report = validateWorkflow({ nodes: FPM_FAI_DEFINITION.nodes, edges: FPM_FAI_DEFINITION.edges, metadata: FPM_FAI_METADATA });
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
    expect(WORKFLOW_TEMPLATES.find((item) => item.key === "fpm_fai")).toBeUndefined();
    expect(userMatchesAssignees(["quality_engineer"], [{ label: "Quality Engineer", roleName: "quality_engineer" }])).toBe(true);
    const documentReview = FPM_FAI_DEFINITION.nodes.find((node) => node.id === FPM_NODE.documentReview);
    expect(documentReview?.config.assignees).toEqual([{ label: "Quality Engineer", roleName: "quality_engineer" }]);
    const retest = FPM_FAI_DEFINITION.nodes.find((node) => node.id === FPM_NODE.retest);
    expect(retest?.config.assignees).toEqual([{ label: "Quality Manager", roleName: "quality_manager" }]);
    expect(FPM_FAI_DEFINITION.nodes).toHaveLength(26);
    expect(FPM_FAI_DEFINITION.edges).toHaveLength(35);
    const edge = (from: string, to: string, branch?: string) => FPM_FAI_DEFINITION.edges.some((item) => item.from === from && item.to === to && item.branch === branch);
    expect(edge(FPM_NODE.trigger, FPM_NODE.documentReview)).toBe(true);
    expect(edge(FPM_NODE.documentReview, FPM_NODE.parallel, "approved")).toBe(true);
    expect(edge(FPM_NODE.documentReview, FPM_NODE.correct, "return")).toBe(true);
    expect(edge(FPM_NODE.documentReview, FPM_NODE.reject, "rejected")).toBe(true);
    expect(edge(FPM_NODE.correct, FPM_NODE.documentReview)).toBe(true);
    expect(edge(FPM_NODE.reject, FPM_NODE.endRejected)).toBe(true);
    expect(edge(FPM_NODE.failures, FPM_NODE.ncr, "true")).toBe(true);
    expect(edge(FPM_NODE.failures, FPM_NODE.engineeringGate, "false")).toBe(true);
    expect(edge(FPM_NODE.retestPassed, FPM_NODE.finalApproval, "true")).toBe(true);
    expect(edge(FPM_NODE.retestPassed, FPM_NODE.failures, "false")).toBe(true);
    expect(edge(FPM_NODE.retest, FPM_NODE.openAttempt, "approved")).toBe(true);
    expect(edge(FPM_NODE.retest, FPM_NODE.corrective, "return")).toBe(true);
    expect(edge(FPM_NODE.retest, FPM_NODE.reject, "rejected")).toBe(true);
    expect(edge(FPM_NODE.finalApproval, FPM_NODE.release, "approved")).toBe(true);
    expect(edge(FPM_NODE.finalApproval, FPM_NODE.ncr, "rejected")).toBe(true);
    expect(edge(FPM_NODE.release, FPM_NODE.archive)).toBe(true);
    expect(edge(FPM_NODE.archive, FPM_NODE.endApproved)).toBe(true);
  });

  it("releases a passing fuel pump and archives the record", async () => {
    const execution = await walk(seedResults(emptyState("2026-10-05T12:00:00.000Z")), () => approve);
    const state = readFpm(execution.context);
    expect(execution.status).toBe("completed");
    expect(state.productionRelease).toBe("Yes");
    expect(state.status).toBe("Closed");
    expect(state.locked).toBe("Yes");
    expect(state.dateClosed).toBeTruthy();
    expect(state.approvalDate).toBeTruthy();
    expect(state.outcomeDisplay).toBe("The fuel pump is approved for production.");
    expect(state.overallResult).toBe("Passed");
    expect(state.flowRateResult).toBe("Pass");
    expect(state.pressureResult).toBe("Pass");
    expect(state.currentDrawResult).toBe("Pass");
    expect(state.electricalResult).toBe("Pass");
    expect(state.fitmentResult).toBe("Pass");
    expect(state.packagingResult).toBe("Pass");
    const archive = state.archive as { flowData: unknown[]; pressureData: unknown[]; photos: unknown[]; approvals: unknown; ncrHistory: { linkedNcr: number | null } };
    expect(archive.flowData).toHaveLength(1);
    expect(archive.pressureData).toHaveLength(1);
    expect(archive.approvals).toBeTruthy();
    expect(archive.ncrHistory.linkedNcr).toBeNull();
    const nodes = (execution.context.steps as { node: string; kind: string }[]).map((step) => step.node);
    expect(nodes).toEqual(expect.arrayContaining([FPM_NODE.visual, FPM_NODE.dimensional, FPM_NODE.electrical, FPM_NODE.functional, FPM_NODE.fitment, FPM_NODE.packaging, FPM_NODE.release, FPM_NODE.archive, FPM_NODE.endApproved]));
    const kinds = (execution.context.steps as { kind: string }[]).map((step) => step.kind);
    expect(kinds).toContain("fpm_release");
    expect(kinds).toContain("fpm_archive");
    const targets = ((execution.context.notices as { targets?: string[] }[]) ?? []).flatMap((notice) => notice.targets ?? []);
    expect(targets).toEqual(expect.arrayContaining(["Quality", "Engineering", "Purchasing", "Operations"]));
  });

  it("opens an NCR for a failed fuel pump and does not release it", async () => {
    const failed = seedResults(emptyState("2026-10-05T12:00:00.000Z"), (criterion, entry) =>
      criterion.key === "leak_check" ? { ...entry, result: "Fail", comments: "Leak at the outlet", critical: true } : entry,
    );
    const execution = await walk(failed, (pending) => (pending.pauseUntil === "correctiveActionReady" ? "stop" : approve));
    const state = readFpm(execution.context);
    expect(state.productionRelease).toBe("No");
    expect(state.failureDetected).toBe("Yes");
    expect(state.overallResult).toBe("Failed");
    expect(state.ncrRequired).toBe("Yes");
    expect(state.criticalNoticeSent).toBe(true);
    const notices = (execution.context.notices as { targets?: string[]; channel?: string }[]) ?? [];
    expect(notices.some((notice) => notice.channel === "in_app" && notice.targets?.includes("Quality Manager") && notice.targets?.includes("Engineering Manager"))).toBe(true);
    expect(notices.some((notice) => notice.channel === "email")).toBe(false);
    const kinds = (execution.context.steps as { kind: string }[]).map((step) => step.kind);
    expect(kinds).toContain("fpm_create_ncr");
    expect(kinds).not.toContain("fpm_release");
    expect(() => assertCanRelease(state)).toThrow(/Production release is not allowed/);
    const releaseOnly = {
      nodes: [
        { id: "t", type: "trigger" as const, kind: "fpm_fai_submitted", config: {} },
        { id: "rel", type: "action" as const, kind: "fpm_release", config: {} },
      ],
      edges: [{ from: "t", to: "rel" }],
    };
    await expect(executeWorkflow(releaseOnly, { ...state }, { triggerKind: "fpm_fai_submitted" })).rejects.toThrow(/Production release is not allowed/);
    expect(state.productionRelease).toBe("No");
  });

  it("does not treat a missing limit as a Pass", async () => {
    const missing = seedResults(emptyState("2026-10-05T12:00:00.000Z"), (criterion: FpmCriterion, entry) =>
      criterion.key === "overall_height" ? { key: criterion.key, result: "Pass", actual: "10", units: "mm" } : entry,
    );
    const height = missing.attempt.results.find((row) => row.key === "overall_height");
    expect(height?.result).toBe("Engineering Review Required");
    const heightCriterion = FPM_CRITERIA.find((row) => row.key === "overall_height");
    expect(heightCriterion && judgeCriterion(heightCriterion, { actual: "10", units: "mm", specifiedLimits: "9-11", result: "Fail" }, null).result).toBe("Pass");
    expect(heightCriterion && judgeCriterion(heightCriterion, { actual: "12", units: "mm", specifiedLimits: "9-11", comments: "Tall", result: "Pass" }, null).result).toBe("Fail");
    expect(heightCriterion && judgeCriterion(heightCriterion, { actual: "10", units: "mm", specifiedLimits: "see drawing", result: "Pass" }, null).result).toBe("");
    expect(height?.result).not.toBe("Pass");
    expect(height?.specifiedLimits).toBeNull();
    const execution = await walk(missing, (pending) => (pending.nodeId === FPM_NODE.engineering ? "stop" : approve));
    const state = readFpm(execution.context);
    expect(state.overallResult).toBe("Pending Engineering Review");
    expect(state.productionRelease).toBe("No");
    expect((execution.context.steps as { kind: string }[]).map((step) => step.kind)).not.toContain("fpm_release");
    expect(() => assertCanRelease(state, { finalApprovalRecorded: true })).toThrow(/missing limit is not a Pass/);
  });

  it("rejects the document and says the fuel pump is not approved", async () => {
    const execution = await walk(seedResults(emptyState("2026-10-05T12:00:00.000Z")), (pending) => {
      if (pending.nodeId !== FPM_NODE.documentReview) return approve;
      return { decision: "rejected", notes: "Wrong part number", details: { rejectionReason: "Wrong part number", rejectedBy: "Quality Engineer", rejectionDate: "2026-10-06" } };
    });
    const state = readFpm(execution.context);
    expect(execution.status).toBe("completed");
    expect(state.status).toBe("Rejected");
    expect(state.productionRelease).toBe("No");
    expect(state.outcomeDisplay).toBe("The fuel pump is not approved for production.");
    expect((execution.context.steps as { node: string }[]).map((step) => step.node)).toContain(FPM_NODE.endRejected);
    expect((execution.context.steps as { kind: string }[]).map((step) => step.kind)).not.toContain("fpm_release");
  });

  it("keeps the failed attempt when a retest is approved", async () => {
    const failed = seedResults(emptyState("2026-10-05T12:00:00.000Z"), (criterion, entry) =>
      criterion.key === "no_cracks" ? { ...entry, result: "Fail", comments: "Crack in the housing", photos: [{ fileName: "crack.jpg" }] } : entry,
    );
    const execution = await walk(failed, (pending, state) => {
      if (pending.pauseUntil === "correctiveActionReady") return corrective;
      if (pending.nodeId === FPM_NODE.retest) return { decision: "approved", notes: "Retest the replacement." };
      if (pending.nodeId === FPM_NODE.visual && state.attempt.number === 2) return "stop";
      return approve;
    });
    const state = readFpm(execution.context);
    expect(state.attempt.number).toBe(2);
    expect(state.history).toHaveLength(1);
    expect(state.history[0]?.overall).toBe("Failed");
    expect(state.history[0]?.results.some((row) => row.key === "no_cracks" && row.result === "Fail")).toBe(true);
    expect(state.attempt.results.some((row) => row.key === "no_cracks" && row.result === "Fail")).toBe(false);
    expect(state.productionRelease).toBe("No");
  });

  it("sends a failed retest back to Create NCR without spinning", async () => {
    const failed = seedResults(emptyState("2026-10-05T12:00:00.000Z"), (criterion, entry) =>
      criterion.key === "no_cracks" ? { ...entry, result: "Fail", comments: "Crack in the housing", photos: [{ fileName: "crack.jpg" }] } : entry,
    );
    let corrections = 0;
    const execution = await walk(failed, (pending, state) => {
      if (pending.pauseUntil === "correctiveActionReady") {
        corrections += 1;
        if (state.attempt.number >= 2) return "stop";
        return corrective;
      }
      if (pending.nodeId === FPM_NODE.retest) return { decision: "approved", notes: "Retest the replacement." };
      if (state.attempt.number >= 2 && state.attempt.results.length === 0 && pending.branch) return { decision: "approved", seed: "fail" };
      return approve;
    });
    const state = readFpm(execution.context);
    expect(execution.status).toBe("waiting_approval");
    expect(corrections).toBe(2);
    expect(state.attempt.number).toBe(2);
    expect(state.overallResult).toBe("Failed");
    expect(state.history[0]?.results.some((row) => row.key === "no_cracks" && row.result === "Fail")).toBe(true);
    const nodes = (execution.context.steps as { node: string }[]).map((step) => step.node);
    expect(nodes.filter((node) => node === FPM_NODE.ncr).length).toBeGreaterThanOrEqual(2);
    expect(nodes).toContain(FPM_NODE.retestPassed);
    expect(state.productionRelease).toBe("No");
  });

  it("blocks release when the retest passed and the NCR is still open", async () => {
    const failed = seedResults(emptyState("2026-10-05T12:00:00.000Z"), (criterion, entry) =>
      criterion.key === "no_cracks" ? { ...entry, result: "Fail", comments: "Crack in the housing", photos: [{ fileName: "crack.jpg" }] } : entry,
    );
    const execution = await walk(failed, (pending, state) => {
      if (pending.pauseUntil === "correctiveActionReady") return corrective;
      if (pending.nodeId === FPM_NODE.retest) return { decision: "approved", notes: "Retest the replacement." };
      if (pending.nodeId === FPM_NODE.finalApproval) return "stop";
      if (state.attempt.number === 2 && state.attempt.results.length === 0 && pending.branch) return { decision: "approved", seed: "pass" };
      return approve;
    });
    const state = readFpm(execution.context);
    expect(state.attempt.overall).toBe("Passed");
    expect(state.ncrRequired).toBe("Yes");
    expect(state.ncrStatus).not.toBe("closed");
    expect(state.productionRelease).toBe("No");
    expect(() => assertCanRelease(state, { finalApprovalRecorded: true })).toThrow(/linked NCR is not done/);
    expect((execution.context.steps as { kind: string }[]).map((step) => step.kind)).not.toContain("fpm_release");
  });

  it("reminds at 75 percent, warns at 90 percent, then marks overdue and escalated", () => {
    const start = "2026-10-05T12:00:00.000Z";
    expect(addBusinessDays(start, 2)).toBe("2026-10-07");
    expect(addBusinessDays(start, 5)).toBe("2026-10-12");
    expect(addBusinessDays(start, 10)).toBe("2026-10-19");
    expect(addBusinessDays(start, 3)).toBe("2026-10-08");
    expect(addCalendarDays(start, 30)).toBe("2026-11-04");
    const reminder = evaluateSla({ startedAt: start, now: "2026-10-09T15:00:00.000Z", businessDays: 5 });
    expect(reminder.status).toBe("Reminder");
    expect(reminder.notifyOwner).toBe(true);
    expect(reminder.notifyQualityManager).toBe(false);
    const warning = evaluateSla({ startedAt: start, now: "2026-10-12T15:00:00.000Z", businessDays: 5 });
    expect(warning.status).toBe("Warning");
    expect(warning.notifyOwner).toBe(true);
    expect(warning.notifyQualityManager).toBe(true);
    const overdue = evaluateSla({ startedAt: start, now: "2026-10-08T15:00:00.000Z", businessDays: 2 });
    expect(overdue.status).toBe("Overdue");
    expect(overdue.notifyOwner).toBe(true);
    expect(overdue.notifyQualityManager).toBe(true);
    const escalated = evaluateSla({ startedAt: start, now: "2026-10-13T15:00:00.000Z", businessDays: 2 });
    expect(escalated.status).toBe("Escalated");
    expect(escalated.overdueDays).toBeGreaterThan(3);
    expect(escalated.notifyQualityManager).toBe(true);
    expect(escalated.notifyOperationsManager).toBe(true);
    expect(businessDaysAfter("2026-10-07", "2026-10-07")).toBe(0);
    expect(evaluateOverallSla(start, "2026-10-28T12:00:00.000Z").status).toBe("Reminder");
    expect(evaluateOverallSla(start, "2026-11-01T12:00:00.000Z").status).toBe("Warning");
    expect(evaluateOverallSla(start, "2026-11-05T12:00:00.000Z").status).toBe("Overdue");
    expect(evaluateOverallSla(start, "2026-11-08T12:00:00.000Z").status).toBe("Escalated");
  });

  it("keeps the controlled version a draft and uses migration 0104", () => {
    expect(FPM_CONTROLLED_VERSION_STATUS).toBe("draft");
    const service = readFileSync(new URL("../src/modules/fuel-pump-fai/fuelPumpFai.service.ts", import.meta.url), "utf8");
    expect(service).toContain('isActive: "false"');
    expect(service).toContain("createInitialDraft");
    expect(service).not.toMatch(/status:\s*"published"/);
    const sql = readFileSync(new URL("../src/drizzle/migrations/0104_fuel_pump_fai.sql", import.meta.url), "utf8");
    expect(sql).toContain("fuel_pump_fai_records");
    expect(sql).toContain("fai_number");
    expect(sql).toContain("flow_rate_result");
    expect(sql).toContain("pressure_result");
    expect(sql).toContain("current_draw_result");
    expect(sql).toContain("electrical_result");
    expect(sql).toContain("fitment_result");
    expect(sql).toContain("packaging_result");
    expect(sql).toContain("linked_ncr");
    expect(sql).toContain("sla_status");
    expect(sql.toLowerCase()).not.toContain("controlled_versions");
    expect(sql).not.toContain("'published'");
    const journal = readFileSync(new URL("../src/drizzle/migrations/meta/_journal.json", import.meta.url), "utf8");
    expect(journal).toContain('"tag": "0103_csa_first_article"');
    expect(journal).toContain('"tag": "0104_fuel_pump_fai"');
    expect(journal.indexOf('"tag": "0103_csa_first_article"')).toBeLessThan(journal.indexOf('"tag": "0104_fuel_pump_fai"'));
    expect(journal).toContain('"idx": 103');
    expect(journal).toContain('"idx": 104');
  });
});
