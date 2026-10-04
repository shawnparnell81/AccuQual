import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { executeWorkflow, resumeWorkflow } from "../src/modules/workflow/workflow-engine.js";
import { validateWorkflow } from "../src/modules/workflow/workflow-graph.js";
import { NCR_PROCESS_NAME, ncrProcessDefinition } from "../src/modules/workflow/ncrProcess.workflow.js";
import { NCR_SLA_RULES } from "../src/modules/ncr/ncrSla.js";
import { nextApprovalState } from "../src/modules/workflow/assignees.js";
import "../src/modules/workflow/workflowActions.js";

const def = ncrProcessDefinition;
const steps = (context: Record<string, unknown>) => ((context.steps as { node: string }[]) ?? []).map((step) => step.node);

describe("NCR process workflow", () => {
  it("is one workflow, allows return loops, and keeps the 18-step path", () => {
    const report = validateWorkflow({ nodes: def.nodes, edges: def.edges, metadata: def.metadata });
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
    expect(def.metadata?.allowLoops).toBe(true);
    expect(def.metadata?.name).toBe(NCR_PROCESS_NAME);
    expect(def.metadata?.sla).toBe(NCR_SLA_RULES);
    const labels = def.nodes.map((node) => node.label);
    for (const label of ["NCR Submitted", "Initialize NCR", "Quality Review", "Containment Required?", "Reject NCR", "NCR Rejected", "Containment Activities", "Root Cause Analysis", "Corrective Action Planning", "Implement Corrective Actions", "Update Procedure", "Operator Training", "Inspection Plan Update", "Management Approval", "Effectiveness Verification", "Effective?", "Close NCR", "NCR Closed"]) {
      expect(labels).toContain(label);
    }
    expect(def.nodes.some((node) => node.type === "integration")).toBe(false);
    expect(def.edges.some((edge) => edge.from === "a2" && edge.to === "ap3")).toBe(false);
  });

  it("closes a minor NCR that does not need containment", async () => {
    const result = await executeWorkflow(def, { severity: "Minor", containment_required: "No", effective: "Yes", recurrence_detected: "No", days_open: 1 }, { triggerKind: "submitted", dryRun: true });
    expect(result.status).toBe("completed");
    const visited = steps(result.context);
    expect(visited).toContain("e18");
    expect(visited).not.toContain("a7");
    expect(visited.indexOf("ap_exec")).toBe(-1);
    expect(visited.indexOf("p_side")).toBeLessThan(visited.indexOf("ap3"));
  });

  it("sends a critical NCR through executive approval before quality review", async () => {
    const paused = await executeWorkflow(def, { severity: "Critical", containment_required: "Yes" }, { triggerKind: "submitted" });
    expect(paused.status).toBe("waiting_approval");
    expect(paused.currentNodeId).toBe("ap_exec");
    expect(paused.state.visited).not.toContain("ap3");
    const simulated = await executeWorkflow(def, { severity: "Critical", containment_required: "Yes", effective: "Yes", recurrence_detected: "No" }, { triggerKind: "submitted", dryRun: true });
    const visited = steps(simulated.context);
    expect(visited.indexOf("ap_exec")).toBeGreaterThan(-1);
    expect(visited.indexOf("ap_exec")).toBeLessThan(visited.indexOf("ap3"));
    expect(visited).toContain("a7");
  });

  it("rejects at quality review without starting root cause", async () => {
    const result = await executeWorkflow(def, { severity: "Minor", simulateApproval: "rejected" }, { triggerKind: "submitted", dryRun: true });
    const visited = steps(result.context);
    expect(visited).toContain("e6");
    expect(visited).not.toContain("a8");
  });

  it("returns management rejection to planning and does not verify effectiveness", async () => {
    const context = { severity: "Minor", containment_required: "No", effective: "Yes", recurrence_detected: "No" };
    const review = await executeWorkflow(def, context, { triggerKind: "submitted" });
    expect(review.currentNodeId).toBe("ap3");
    const implementation = await resumeWorkflow(def, review.state, review.context, "approved");
    expect(implementation.currentNodeId).toBe("ap14");
    const returned = await resumeWorkflow(def, implementation.state, implementation.context, "rejected");
    expect(steps(returned.context)).not.toContain("a15");
    expect(returned.status).toBe("completed");
  });

  it("does not close an ineffective NCR", async () => {
    const result = await executeWorkflow(def, { severity: "Minor", containment_required: "No", effective: "No", recurrence_detected: "Yes" }, { triggerKind: "submitted", dryRun: true });
    expect(steps(result.context)).not.toContain("e18");
    expect(steps(result.context)).toContain("a8");
  });

  it("stores the same graph in the migration", () => {
    const sql = readFileSync(new URL("../src/drizzle/migrations/0102_ncr_process_workflow.sql", import.meta.url), "utf8");
    const match = sql.match(/\$ncrdef\$([\s\S]*)\$ncrdef\$/);
    expect(match).toBeTruthy();
    const stored = JSON.parse(match![1]!) as { nodes: { id: string }[]; edges: { from: string; to: string }[]; metadata: { allowLoops?: boolean; sla?: { overallDays?: { Minor: number } } } };
    expect(stored.nodes.map((node) => node.id)).toEqual(def.nodes.map((node) => node.id));
    expect(stored.edges).toEqual(def.edges);
    expect(stored.metadata.allowLoops).toBe(true);
    expect(stored.metadata.sla?.overallDays?.Minor).toBe(30);
    expect(sql).toContain("'draft'");
    expect(sql).not.toContain("'published'");
    expect(sql).toContain("'false'");
    const journal = JSON.parse(readFileSync(new URL("../src/drizzle/migrations/meta/_journal.json", import.meta.url), "utf8")) as { entries: { idx: number; tag: string }[] };
    const tags = journal.entries.map((entry) => entry.tag);
    expect(tags).toContain("0101_clear_published_versions");
    expect(tags).not.toContain("0101_ncr_process_workflow");
    expect(journal.entries.find((entry) => entry.tag === "0102_ncr_process_workflow")).toMatchObject({ idx: 102, tag: "0102_ncr_process_workflow" });
    expect(journal.entries.find((entry) => entry.tag === "0103_csa_first_article")).toMatchObject({ idx: 103, tag: "0103_csa_first_article" });
    expect(journal.entries.at(-1)).toMatchObject({ idx: 104, tag: "0104_fuel_pump_fai" });
  });
});

describe("multi-title approval", () => {
  it("waits until every stored title has approved", () => {
    const first = nextApprovalState({ decision: "approved", titles: ["Quality Manager", "Operations Manager"], approvalMode: "all", roleName: "quality_manager", fullAccess: false, alreadyApproved: [] });
    expect(first.waiting).toBe(true);
    const second = nextApprovalState({ decision: "approved", titles: ["Quality Manager", "Operations Manager"], approvalMode: "all", roleName: "Operations Manager", fullAccess: false, alreadyApproved: first.approvedTitles });
    expect(second.waiting).toBe(false);
    const rejected = nextApprovalState({ decision: "rejected", titles: ["Quality Manager", "Operations Manager"], approvalMode: "all", roleName: "quality_manager", fullAccess: false, alreadyApproved: [] });
    expect(rejected.waiting).toBe(false);
  });
});
