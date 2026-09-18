import { describe, expect, it, beforeAll } from "vitest";
import { runWorkflow, registerActionHandler, type WorkflowDefinition } from "../src/modules/workflow/workflow-engine.js";

describe("workflow-engine", () => {
  // Phase 9 — the engine itself ships with NO built-in action handlers
  // (real ones live in workflowActions.ts, registered once at API/worker
  // startup); a pure engine unit test registers its own minimal test
  // double, same as it would for any other handler kind.
  beforeAll(() => {
    registerActionHandler("send_email", (node, context) => {
      context.actionsRun = [...((context.actionsRun as unknown[]) ?? []), { kind: "send_email", node: node.id }];
    });
  });

  const definition: WorkflowDefinition = {
    nodes: [
      { id: "t1", type: "trigger", kind: "ncr_closed", config: {} },
      { id: "c1", type: "condition", kind: "severity_equals", config: { field: "severity", equals: "critical" } },
      { id: "a1", type: "action", kind: "send_email", config: {} },
    ],
    edges: [
      { from: "t1", to: "c1" },
      { from: "c1", to: "a1" },
    ],
  };

  it("runs the action when the condition passes", async () => {
    const result = await runWorkflow(definition, { severity: "critical" }, "ncr_closed");
    expect(result.actionsRun).toEqual([{ kind: "send_email", node: "a1" }]);
  });

  it("short-circuits the branch when the condition fails", async () => {
    const result = await runWorkflow(definition, { severity: "low" }, "ncr_closed");
    expect(result.actionsRun).toBeUndefined();
  });

  it("only walks triggers matching the given trigger kind", async () => {
    const result = await runWorkflow(definition, { severity: "critical" }, "capa_closed");
    expect(result.actionsRun).toBeUndefined();
  });

  it("records every condition evaluated, including short-circuited ones (for health/simulation visibility)", async () => {
    const result = await runWorkflow(definition, { severity: "low" }, "ncr_closed");
    expect(result.conditionsEvaluated).toEqual([{ node: "c1", kind: "severity_equals", passed: false }]);
  });

  it("flags an action node whose kind has no registered handler (a real 'missing action' case)", async () => {
    const unregistered: WorkflowDefinition = {
      nodes: [
        { id: "t1", type: "trigger", kind: "ncr_closed", config: {} },
        { id: "a1", type: "action", kind: "not_a_real_action", config: {} },
      ],
      edges: [{ from: "t1", to: "a1" }],
    };
    const result = await runWorkflow(unregistered, {}, "ncr_closed");
    expect(result.unregisteredActions).toEqual([{ node: "a1", kind: "not_a_real_action" }]);
  });

  it("passes dryRun through to the action handler for Simulation Mode", async () => {
    const seen: boolean[] = [];
    registerActionHandler("record_dry_run", (_node, _context, dryRun) => {
      seen.push(dryRun);
    });
    const simDefinition: WorkflowDefinition = {
      nodes: [
        { id: "t1", type: "trigger", kind: "ncr_closed", config: {} },
        { id: "a1", type: "action", kind: "record_dry_run", config: {} },
      ],
      edges: [{ from: "t1", to: "a1" }],
    };
    await runWorkflow(simDefinition, {}, "ncr_closed", true);
    await runWorkflow(simDefinition, {}, "ncr_closed", false);
    expect(seen).toEqual([true, false]);
  });

  it("supports the new richer condition operators (in / notEquals / greaterOrEqual / contains)", async () => {
    const richDefinition: WorkflowDefinition = {
      nodes: [
        { id: "t1", type: "trigger", kind: "receiving_rejected", config: {} },
        { id: "c1", type: "condition", kind: "defect_category_in", config: { field: "defectCategory", in: ["dimensional", "functional"] } },
        { id: "c2", type: "condition", kind: "recurrence_gte", config: { field: "occurrences", greaterOrEqual: 3 } },
        { id: "a1", type: "action", kind: "send_email", config: {} },
      ],
      edges: [
        { from: "t1", to: "c1" },
        { from: "c1", to: "c2" },
        { from: "c2", to: "a1" },
      ],
    };
    const passes = await runWorkflow(richDefinition, { defectCategory: "dimensional", occurrences: 3 }, "receiving_rejected");
    expect(passes.actionsRun).toEqual([{ kind: "send_email", node: "a1" }]);

    const fails = await runWorkflow(richDefinition, { defectCategory: "cosmetic", occurrences: 5 }, "receiving_rejected");
    expect(fails.actionsRun).toBeUndefined();
  });

  // Full-System Audit finding C5 — a tenant-authored graph with a cycle
  // (buildable via the drag-and-drop builder, since the save-time schema
  // never checks graph structure) used to recurse forever here, crashing
  // the shared workflow-worker process for every tenant. A short explicit
  // test timeout (well under vitest's default) turns "hangs forever" into
  // a fast, unambiguous failure if this guard ever regresses, instead of
  // the whole suite stalling.
  it("terminates instead of recursing forever on a cyclic graph (a1 -> a2 -> a1)", async () => {
    const cyclic: WorkflowDefinition = {
      nodes: [
        { id: "t1", type: "trigger", kind: "ncr_closed", config: {} },
        { id: "a1", type: "action", kind: "send_email", config: {} },
        { id: "a2", type: "action", kind: "send_email", config: {} },
      ],
      edges: [
        { from: "t1", to: "a1" },
        { from: "a1", to: "a2" },
        { from: "a2", to: "a1" }, // cycle back to a1
      ],
    };
    const result = await runWorkflow(cyclic, {}, "ncr_closed");
    // Each node visited (and its action fired) exactly once, not looped.
    expect(result.actionsRun).toEqual([
      { kind: "send_email", node: "a1" },
      { kind: "send_email", node: "a2" },
    ]);
  }, 2000);

  it("a diamond-shaped graph (two paths re-converging on the same node) fires the shared node's action once, not twice", async () => {
    const diamond: WorkflowDefinition = {
      nodes: [
        { id: "t1", type: "trigger", kind: "ncr_closed", config: {} },
        { id: "c1", type: "condition", kind: "severity_equals", config: { field: "severity", equals: "critical" } },
        { id: "c2", type: "condition", kind: "severity_equals", config: { field: "severity", equals: "critical" } },
        { id: "shared", type: "action", kind: "send_email", config: {} },
      ],
      edges: [
        { from: "t1", to: "c1" },
        { from: "t1", to: "c2" },
        { from: "c1", to: "shared" },
        { from: "c2", to: "shared" },
      ],
    };
    const result = await runWorkflow(diamond, { severity: "critical" }, "ncr_closed");
    expect(result.actionsRun).toEqual([{ kind: "send_email", node: "shared" }]);
  });
});
