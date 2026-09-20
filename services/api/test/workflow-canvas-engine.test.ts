import { describe, expect, it } from "vitest";
import { executeWorkflow, resumeWorkflow, registerActionHandler, WorkflowNodeError, type WorkflowDefinition } from "../src/modules/workflow/workflow-engine.js";
import { validateWorkflow } from "../src/modules/workflow/workflow-graph.js";
import { diffFormVersions, diffWorkflowVersions } from "../src/modules/versioning/diff.js";
import { getFormLayout } from "../src/modules/forms/layouts/index.js";
import "../src/modules/workflow/workflowActions.js"; // registers the real handlers (send_email, erp_sync, ...)

const ran: string[] = [];
registerActionHandler("canvas_test_a", (_n, ctx) => void (ran.push("a"), (ctx.a = true)));
registerActionHandler("canvas_test_b", () => void ran.push("b"));
registerActionHandler("canvas_test_c", () => void ran.push("c"));
registerActionHandler("canvas_test_boom", () => {
  throw new Error("boom");
});

const n = (id: string, type: WorkflowDefinition["nodes"][number]["type"], kind: string, config: Record<string, unknown> = {}) => ({ id, type, kind, config });
const e = (from: string, to: string, branch?: string) => ({ from, to, ...(branch ? { branch } : {}) });

describe("workflow execution model", () => {
  it("follows a condition's true and false transitions", async () => {
    const def: WorkflowDefinition = {
      nodes: [n("t", "trigger", "go"), n("c", "condition", "sev", { field: "severity", equals: "high" }), n("yes", "action", "canvas_test_a"), n("no", "action", "canvas_test_b")],
      edges: [e("t", "c"), e("c", "yes", "true"), e("c", "no", "false")],
    };
    ran.length = 0;
    await executeWorkflow(def, { severity: "high" }, { triggerKind: "go" });
    expect(ran).toEqual(["a"]);
    ran.length = 0;
    await executeWorkflow(def, { severity: "low" }, { triggerKind: "go" });
    expect(ran).toEqual(["b"]);
  });

  it("runs the same nodes in the same order every time, depth-first", async () => {
    const def: WorkflowDefinition = {
      nodes: [n("t", "trigger", "go"), n("p", "parallel", "fork"), n("x", "action", "canvas_test_a"), n("y", "action", "canvas_test_b"), n("z", "action", "canvas_test_c")],
      edges: [e("t", "p"), e("p", "x"), e("p", "y"), e("x", "z")],
    };
    const orders: string[] = [];
    for (let i = 0; i < 3; i++) {
      ran.length = 0;
      await executeWorkflow(def, {}, { triggerKind: "go" });
      orders.push(ran.join(""));
    }
    expect(new Set(orders).size).toBe(1);
    expect(orders[0]).toBe("acb"); // x, then x's own subtree (z), then y
  });

  it("a node reached by two parallel branches runs once", async () => {
    const def: WorkflowDefinition = {
      nodes: [n("t", "trigger", "go"), n("p", "parallel", "fork"), n("x", "action", "canvas_test_a"), n("y", "action", "canvas_test_b"), n("join", "action", "canvas_test_c")],
      edges: [e("t", "p"), e("p", "x"), e("p", "y"), e("x", "join"), e("y", "join")],
    };
    ran.length = 0;
    await executeWorkflow(def, {}, { triggerKind: "go" });
    expect(ran.filter((r) => r === "c")).toHaveLength(1);
  });

  it("an end node stops its branch", async () => {
    const def: WorkflowDefinition = {
      nodes: [n("t", "trigger", "go"), n("a", "action", "canvas_test_a"), n("end", "end", "end"), n("after", "action", "canvas_test_b")],
      edges: [e("t", "a"), e("a", "end"), e("end", "after")],
    };
    ran.length = 0;
    const result = await executeWorkflow(def, {}, { triggerKind: "go" });
    expect(ran).toEqual(["a"]);
    expect(result.status).toBe("completed");
  });

  it("pauses at an approval node, saves its position, and resumes down the chosen path", async () => {
    const def: WorkflowDefinition = {
      nodes: [
        n("t", "trigger", "go"),
        n("before", "action", "canvas_test_a"),
        n("ok?", "approval", "approval", { approverRole: "quality_manager" }),
        n("approved", "action", "canvas_test_b"),
        n("rejected", "action", "canvas_test_c"),
      ],
      edges: [e("t", "before"), e("before", "ok?"), e("ok?", "approved", "approved"), e("ok?", "rejected", "rejected")],
    };
    ran.length = 0;
    const paused = await executeWorkflow(def, {}, { triggerKind: "go" });
    expect(paused.status).toBe("waiting_approval");
    expect(paused.currentNodeId).toBe("ok?");
    expect(paused.state.waitingNodeId).toBe("ok?");
    expect(paused.context.pendingApproval).toMatchObject({ nodeId: "ok?", approverRole: "quality_manager" });
    expect(ran).toEqual(["a"]);

    // The saved state survives a round trip through JSON, as it does in the database.
    const saved = JSON.parse(JSON.stringify(paused.state));
    ran.length = 0;
    const done = await resumeWorkflow(def, saved, { ...paused.context }, "approved");
    expect(done.status).toBe("completed");
    expect(ran).toEqual(["b"]);

    ran.length = 0;
    await resumeWorkflow(def, saved, { ...paused.context }, "rejected");
    expect(ran).toEqual(["c"]);
  });

  it("a simulation never waits on a person", async () => {
    const def: WorkflowDefinition = {
      nodes: [n("t", "trigger", "go"), n("ok?", "approval", "approval", { approverRole: "admin" }), n("yes", "action", "canvas_test_b"), n("no", "action", "canvas_test_c")],
      edges: [e("t", "ok?"), e("ok?", "yes", "approved"), e("ok?", "no", "rejected")],
    };
    ran.length = 0;
    const result = await executeWorkflow(def, {}, { triggerKind: "go", dryRun: true });
    expect(result.status).toBe("completed");
    expect(ran).toEqual(["b"]);
    ran.length = 0;
    await executeWorkflow(def, { simulateApproval: "rejected" }, { triggerKind: "go", dryRun: true });
    expect(ran).toEqual(["c"]);
  });

  it("names the node a run failed on, and records every step", async () => {
    const def: WorkflowDefinition = { nodes: [n("t", "trigger", "go"), n("a", "action", "canvas_test_a"), n("bad", "action", "canvas_test_boom")], edges: [e("t", "a"), e("a", "bad")] };
    await expect(executeWorkflow(def, {}, { triggerKind: "go" })).rejects.toMatchObject({ name: "WorkflowNodeError", nodeId: "bad" });
    await expect(executeWorkflow(def, {}, { triggerKind: "go" })).rejects.toBeInstanceOf(WorkflowNodeError);

    const ok: WorkflowDefinition = { nodes: [n("t", "trigger", "go"), n("a", "action", "canvas_test_a")], edges: [e("t", "a")] };
    const result = await executeWorkflow(ok, {}, { triggerKind: "go" });
    expect(result.context.steps).toEqual([expect.objectContaining({ node: "a", type: "action", result: "done" })]);
  });

  it("a cycle cannot spin forever", async () => {
    const def: WorkflowDefinition = { nodes: [n("t", "trigger", "go"), n("a", "action", "canvas_test_a"), n("b", "action", "canvas_test_b")], edges: [e("t", "a"), e("a", "b"), e("b", "a")] };
    ran.length = 0;
    await executeWorkflow(def, {}, { triggerKind: "go" });
    expect(ran).toEqual(["a", "b"]);
  });

  it("an integration node uses the real handlers (simulated here)", async () => {
    const def: WorkflowDefinition = { nodes: [n("t", "trigger", "go"), n("mail", "integration", "send_email", { to: "a@b.c", subject: "Hi" }), n("erp", "integration", "erp_sync")], edges: [e("t", "mail"), e("mail", "erp")] };
    const result = await executeWorkflow(def, {}, { triggerKind: "go", dryRun: true });
    expect((result.context.actionsRun as { kind: string; simulated?: boolean }[]).map((a) => [a.kind, a.simulated])).toEqual([
      ["send_email", true],
      ["erp_sync", true],
    ]);
  });
});

describe("validateWorkflow", () => {
  const good: WorkflowDefinition = {
    nodes: [n("t", "trigger", "closed"), n("c", "condition", "x", { field: "sev", equals: "high" }), n("m", "action", "assign_user"), n("end", "end", "end")],
    edges: [e("t", "c"), e("c", "m", "true"), e("m", "end")],
  };
  const codes = (input: Parameters<typeof validateWorkflow>[0]) => validateWorkflow(input).errors.map((x) => x.code);

  it("accepts a well-formed workflow", () => {
    const report = validateWorkflow(good);
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it("refuses an empty workflow, a missing trigger, and broken transitions", () => {
    expect(codes({ nodes: [], edges: [] })).toEqual(["empty"]);
    expect(codes({ nodes: [n("a", "action", "assign_user")], edges: [] })).toContain("no_trigger");
    expect(codes({ nodes: good.nodes, edges: [...good.edges, e("m", "ghost")] })).toContain("broken_transition");
  });

  it("refuses unreachable nodes and dead ends", () => {
    expect(codes({ nodes: [...good.nodes, n("orphan", "action", "assign_user")], edges: good.edges })).toContain("unreachable");
    expect(codes({ nodes: [n("t", "trigger", "closed"), n("c", "condition", "x", { field: "f", equals: 1 })], edges: [e("t", "c")] })).toContain("dead_end");
  });

  it("checks each node type's configuration", () => {
    expect(codes({ nodes: [n("t", "trigger", "closed"), n("c", "condition", "x", {})], edges: [e("t", "c"), e("c", "t")] })).toContain("condition_field");
    const withApproval = (config: Record<string, unknown>, extra: WorkflowDefinition["edges"] = []) => ({ nodes: [n("t", "trigger", "closed"), n("a", "approval", "approval", config), n("x", "action", "assign_user")], edges: [e("t", "a"), e("a", "x", "approved"), ...extra] });
    expect(codes(withApproval({}))).toContain("approval_approver");
    expect(codes(withApproval({ approverRole: "admin" }))).toEqual([]);
    expect(validateWorkflow(withApproval({ approverRole: "admin" })).warnings.map((w) => w.code)).toContain("approval_rejected");
    expect(codes({ nodes: [n("t", "trigger", "closed"), n("i", "integration", "carrier_pigeon")], edges: [e("t", "i")] })).toContain("integration_kind");
    expect(codes({ nodes: [n("t", "trigger", "closed"), n("p", "parallel", "fork"), n("x", "action", "assign_user")], edges: [e("t", "p"), e("p", "x")] })).toContain("parallel_branches");
    expect(codes({ nodes: [...good.nodes, n("after", "action", "assign_user")], edges: [...good.edges, e("end", "after")] })).toContain("end_has_output");
  });

  it("refuses a loop unless the workflow allows loops", () => {
    const loop = { nodes: [n("t", "trigger", "closed"), n("a", "action", "assign_user"), n("b", "action", "assign_user")], edges: [e("t", "a"), e("a", "b"), e("b", "a")] };
    expect(codes(loop)).toContain("loop");
    const allowed = validateWorkflow({ ...loop, metadata: { allowLoops: true } });
    expect(allowed.valid).toBe(true);
    expect(allowed.warnings.map((w) => w.code)).toContain("loop");
  });
});

describe("version diffs", () => {
  const base = {
    nodes: [n("t", "trigger", "closed"), n("a", "action", "assign_user", { department: "quality" }), n("b", "action", "send_email")],
    edges: [e("t", "a"), e("a", "b")],
    metadata: { name: "Close-out", category: "quality" },
  };

  it("finds added, removed and changed nodes, transitions and metadata", () => {
    const after = {
      nodes: [n("t", "trigger", "closed"), { ...n("a", "action", "assign_user", { department: "engineering" }), position: { x: 5, y: 5 } }, n("c", "action", "notify_department")],
      edges: [e("t", "a"), e("a", "c")],
      metadata: { name: "Close-out v2", category: "quality", description: "New" },
    };
    const diff = diffWorkflowVersions(base, after);
    const find = (scope: string, key: string) => diff.entries.find((x) => x.scope === scope && x.key === key);
    expect(find("node", "b")?.change).toBe("removed");
    expect(find("node", "c")?.change).toBe("added");
    expect(find("node", "a")).toMatchObject({ change: "changed", details: [{ field: "config.department", from: "quality", to: "engineering" }] });
    expect(find("transition", "a->b")?.change).toBe("removed");
    expect(find("transition", "a->c")?.change).toBe("added");
    expect(find("metadata", "name")).toMatchObject({ change: "changed", from: "Close-out", to: "Close-out v2" });
    expect(find("metadata", "description")?.change).toBe("added");
    expect(find("metadata", "category")).toBeUndefined();
    expect(diff.summary).toEqual({ added: 3, removed: 2, changed: 2 });
  });

  it("does not count moving a node on the canvas as a change", () => {
    const moved = { ...base, nodes: base.nodes.map((x) => ({ ...x, position: { x: 100, y: 200 } })) };
    expect(diffWorkflowVersions(base, moved).entries).toEqual([]);
  });

  it("labels document changes with the layout's own headings", () => {
    const layout = getFormLayout("management_review");
    const before = { reviewDate: "2026-01-01", chairpersonName: "Ana", reviewInputs: [{ details: "old" }, {}, {}] };
    const after = { reviewDate: "2026-01-01", chairpersonName: "Ben", reviewInputs: [{ details: "old" }, { details: "Trend improving" }, {}], actionItems: [{ decision: "Buy a gauge", responsibleOwner: "Cy" }] };
    const diff = diffFormVersions(layout, before, after);
    const labels = diff.entries.map((x) => `${x.change}: ${x.label}`);
    expect(labels).toContain("changed: Chairperson Name");
    expect(labels).toContain("added: Process Performance & Metrics — Observed Systemic Status / Trend Analysis Details");
    // a whole new action-item row is reported as one added row, carrying its contents
    const newRow = diff.entries.find((x) => x.scope === "row" && x.key === "actionItems.0");
    expect(newRow).toMatchObject({ change: "added", to: { decision: "Buy a gauge", responsibleOwner: "Cy" } });
    expect(newRow?.label).toContain("SYSTEM STRATEGIC OUTPUTS");
    expect(diff.entries.some((x) => x.key === "reviewDate")).toBe(false);
  });
});
