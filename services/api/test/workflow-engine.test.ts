import { describe, expect, it } from "vitest";
import { runWorkflow, type WorkflowDefinition } from "../src/modules/workflow/workflow-engine.js";

describe("workflow-engine", () => {
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
});
