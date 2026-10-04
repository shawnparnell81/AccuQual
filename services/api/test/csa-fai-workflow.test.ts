import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { executeWorkflow, resumeWorkflow, type WorkflowExecutionResult } from "../src/modules/workflow/workflow-engine.js";
import { validateWorkflow } from "../src/modules/workflow/workflow-graph.js";
import { WORKFLOW_TEMPLATES } from "../src/modules/workflow/workflow.templates.js";
import { CSA_FAI_DEFINITION, CSA_FAI_METADATA } from "../src/modules/csa-fai/csaFai.workflow.js";
import {
  CSA_CONTROLLED_VERSION_STATUS,
  CSA_CRITERIA,
  CSA_NODE,
  CSA_WORKFLOW_NAME,
  addBusinessDays,
  assertCanRelease,
  businessDaysAfter,
  emptyState,
  evaluateSla,
  judgeCriterion,
  prepareCsaDecision,
  readCsa,
  seedResults,
  userMatchesAssignees,
  writeCsa,
  type CsaCriterion,
  type CsaState,
} from "../src/modules/csa-fai/csaFai.logic.js";
import "../src/modules/csa-fai/csaFai.actions.js";

const ALLOWED = new Set(["trigger", "condition", "action", "approval", "parallel", "end"]);

function contextFrom(state: CsaState): Record<string, unknown> {
  return { ...state, number: state.number || "CSA-FAI-2026-000001" };
}

interface Choice {
  decision: string;
  notes?: string;
  details?: Record<string, unknown>;
}

async function walk(start: CsaState, choose: (pending: { nodeId?: string; pauseUntil?: string }, state: CsaState) => Choice | "stop"): Promise<WorkflowExecutionResult> {
  let execution = await executeWorkflow(CSA_FAI_DEFINITION, contextFrom(start), { triggerKind: "csa_fai_submitted" });
  for (let guard = 0; guard < 40 && execution.status === "waiting_approval"; guard += 1) {
    const pending = execution.context.pendingApproval as { nodeId?: string; pauseUntil?: string; workflowKey?: string; branch?: string };
    const choice = choose(pending, readCsa(execution.context));
    if (choice === "stop") return execution;
    const patch = prepareCsaDecision(pending, choice.decision, choice.notes, choice.details, execution.context);
    writeCsa(execution.context, { ...readCsa(execution.context), ...patch });
    if (!execution.state) throw new Error("The run is waiting without a saved position.");
    execution = await resumeWorkflow(CSA_FAI_DEFINITION, execution.state, execution.context, choice.decision);
  }
  return execution;
}

const approve: Choice = { decision: "approved", notes: "Reviewed." };

describe("CSA first article workflow", () => {
  it("uses the existing node types and is a valid looping draft", () => {
    expect(CSA_FAI_DEFINITION.nodes.every((node) => ALLOWED.has(node.type))).toBe(true);
    expect(CSA_FAI_DEFINITION.nodes.some((node) => node.type === "integration")).toBe(false);
    expect(CSA_CRITERIA.filter((row) => row.branch === "component")).toHaveLength(24);
    expect(CSA_CRITERIA.filter((row) => row.branch === "dimensional")).toHaveLength(15);
    const report = validateWorkflow({ nodes: CSA_FAI_DEFINITION.nodes, edges: CSA_FAI_DEFINITION.edges, metadata: CSA_FAI_METADATA });
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
    const template = WORKFLOW_TEMPLATES.find((item) => item.key === "csa_fai");
    expect(template?.name).toBe(CSA_WORKFLOW_NAME);
    expect(template?.metadata?.allowLoops).toBe(true);
    expect(userMatchesAssignees(["quality_engineer"], [{ label: "Quality Engineer", roleName: "quality_engineer" }])).toBe(true);
  });

  it("releases a passing CSA and closes the record", async () => {
    const execution = await walk(seedResults(emptyState("2026-10-05T12:00:00.000Z")), () => approve);
    const state = readCsa(execution.context);
    expect(execution.status).toBe("completed");
    expect(state.productionRelease).toBe("Yes");
    expect(state.approvedSupplier).toBe("Yes");
    expect(state.status).toBe("Closed");
    expect(state.locked).toBe("Yes");
    expect(state.outcomeDisplay).toBe("The CSA is approved for production.");
    const kinds = (execution.context.steps as { kind: string }[]).map((step) => step.kind);
    expect(kinds).toContain("csa_release");
    expect(kinds).toContain("csa_archive");
  });

  it("does not release a failed CSA", async () => {
    const failed = seedResults(emptyState("2026-10-05T12:00:00.000Z"), (criterion, entry) =>
      criterion.key === "coil_spring" ? { ...entry, result: "Fail", comments: "Cracked coil", photos: [{ fileName: "crack.jpg" }] } : entry,
    );
    const execution = await walk(failed, (pending) => (pending.nodeId === CSA_NODE.corrective ? "stop" : approve));
    const state = readCsa(execution.context);
    expect(state.productionRelease).toBe("No");
    expect(state.failureDetected).toBe("Yes");
    expect(state.overallResult).toBe("Failed");
    expect(state.ncrRequired).toBe("Yes");
    const kinds = (execution.context.steps as { kind: string }[]).map((step) => step.kind);
    expect(kinds).toContain("csa_create_ncr");
    expect(kinds).not.toContain("csa_release");
    expect(() => assertCanRelease(state)).toThrow(/Production release is not allowed/);
    const releaseOnly = {
      nodes: [
        { id: "t", type: "trigger" as const, kind: "csa_fai_submitted", config: {} },
        { id: "rel", type: "action" as const, kind: "csa_release", config: {} },
      ],
      edges: [{ from: "t", to: "rel" }],
    };
    await expect(executeWorkflow(releaseOnly, { ...state }, { triggerKind: "csa_fai_submitted" })).rejects.toThrow(/Production release is not allowed/);
    expect(state.productionRelease).toBe("No");
  });

  it("sends a missing limit to engineering review and blocks release", async () => {
    const missing = seedResults(emptyState("2026-10-05T12:00:00.000Z"), (criterion: CsaCriterion, entry) =>
      criterion.key === "overall_extended_length" ? { key: criterion.key, result: "Pass", actual: "10", units: "mm" } : entry,
    );
    const execution = await walk(missing, (pending) => (pending.nodeId === CSA_NODE.engineering ? "stop" : approve));
    const state = readCsa(execution.context);
    expect(state.overallResult).toBe("Pending Engineering Review");
    expect(state.attempt.results.find((row) => row.key === "overall_extended_length")?.result).toBe("Engineering Review Required");
    const length = CSA_CRITERIA.find((row) => row.key === "overall_extended_length");
    const flags = { dampingTestRequired: false, vehicleFitmentPerformed: false, limitOverrides: {} };
    expect(length && judgeCriterion(length, { actual: "10", units: "mm", specifiedLimits: "9-11", equipment: "caliper", result: "Fail" }, flags).result).toBe("Pass");
    expect(length && judgeCriterion(length, { actual: "12", units: "mm", specifiedLimits: "9-11", equipment: "caliper", comments: "Long", result: "Pass" }, flags).result).toBe("Fail");
    expect(length && judgeCriterion(length, { actual: "10", units: "mm", specifiedLimits: "see drawing", equipment: "caliper", result: "Pass" }, flags).result).toBe("");
    expect(state.productionRelease).toBe("No");
    expect((execution.context.steps as { kind: string }[]).map((step) => step.kind)).not.toContain("csa_release");
    expect(() => assertCanRelease(state, { finalApprovalRecorded: true })).toThrow(/Engineering review is still required/);
  });

  it("rejects the document and says the CSA is not approved", async () => {
    const execution = await walk(seedResults(emptyState("2026-10-05T12:00:00.000Z")), (pending) => {
      if (pending.nodeId !== CSA_NODE.documentReview) return approve;
      return { decision: "rejected", notes: "Wrong part number", details: { rejectionReason: "Wrong part number", rejectedBy: "Quality Manager", rejectionDate: "2026-10-06" } };
    });
    const state = readCsa(execution.context);
    expect(execution.status).toBe("completed");
    expect(state.status).toBe("Rejected");
    expect(state.productionRelease).toBe("No");
    expect(state.outcomeDisplay).toBe("The CSA is not approved for production.");
    expect((execution.context.steps as { kind: string }[]).map((step) => step.kind)).not.toContain("csa_release");
  });

  it("keeps the failed attempt when a retest is approved", async () => {
    const failed = seedResults(emptyState("2026-10-05T12:00:00.000Z"), (criterion, entry) =>
      criterion.key === "coil_spring" ? { ...entry, result: "Fail", comments: "Cracked coil", photos: [{ fileName: "crack.jpg" }] } : entry,
    );
    const execution = await walk(failed, (pending, state) => {
      if (pending.pauseUntil === "correctiveActionReady") {
        return {
          decision: "approved",
          notes: "Corrected",
          details: {
            failureCause: "Coil crack",
            correctiveAction: "Replace the coil",
            owner: "Quality Engineer",
            dueDate: "2026-10-20",
            correctedSampleId: "SAMPLE-2",
            completionEvidence: "Photo of the replacement coil",
          },
        };
      }
      if (pending.nodeId === CSA_NODE.retest) return { decision: "approved", notes: "Retest the replacement." };
      if (pending.nodeId === CSA_NODE.component && state.attempt.number === 2) return "stop";
      return approve;
    });
    const state = readCsa(execution.context);
    expect(state.attempt.number).toBe(2);
    expect(state.history).toHaveLength(1);
    expect(state.history[0]?.overall).toBe("Failed");
    expect(state.history[0]?.results.some((row) => row.key === "coil_spring" && row.result === "Fail")).toBe(true);
    expect(state.attempt.results.some((row) => row.key === "coil_spring" && row.result === "Fail")).toBe(false);
    expect(state.productionRelease).toBe("No");
  });

  it("reminds at 75 percent, then marks overdue and escalated on business days", () => {
    const start = "2026-10-05T12:00:00.000Z";
    expect(addBusinessDays(start, 2)).toBe("2026-10-07");
    expect(evaluateSla({ startedAt: start, now: "2026-10-07T15:00:00.000Z", businessDays: 2 }).status).toBe("Reminder");
    expect(evaluateSla({ startedAt: start, now: "2026-10-08T15:00:00.000Z", businessDays: 2 }).status).toBe("SLA Overdue");
    const escalated = evaluateSla({ startedAt: start, now: "2026-10-13T15:00:00.000Z", businessDays: 2 });
    expect(escalated.status).toBe("SLA Escalated");
    expect(escalated.overdueBusinessDays).toBeGreaterThan(3);
    expect(businessDaysAfter("2026-10-07", "2026-10-07")).toBe(0);
  });

  it("keeps the controlled version a draft and uses migration 0103", () => {
    expect(CSA_CONTROLLED_VERSION_STATUS).toBe("draft");
    const service = readFileSync(new URL("../src/modules/csa-fai/csaFai.service.ts", import.meta.url), "utf8");
    expect(service).toContain('isActive: "false"');
    expect(service).toContain("createInitialDraft");
    expect(service).not.toMatch(/status:\s*"published"/);
    const sql = readFileSync(new URL("../src/drizzle/migrations/0103_csa_first_article.sql", import.meta.url), "utf8");
    expect(sql).toContain("csa_fai_records");
    expect(sql.toLowerCase()).not.toContain("controlled_versions");
    const journal = readFileSync(new URL("../src/drizzle/migrations/meta/_journal.json", import.meta.url), "utf8");
    expect(journal).toContain('"tag": "0102_ncr_process_workflow"');
    expect(journal).toContain('"tag": "0103_csa_first_article"');
    expect(journal.indexOf('"tag": "0102_ncr_process_workflow"')).toBeLessThan(journal.indexOf('"tag": "0103_csa_first_article"'));
    expect(journal).toContain('"idx": 102');
    expect(journal).toContain('"idx": 103');
  });
});
