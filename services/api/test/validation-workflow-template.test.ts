import { describe, expect, it } from "vitest";
import { executeWorkflow, resumeWorkflow, type WorkflowExecutionResult } from "../src/modules/workflow/workflow-engine.js";
import { WORKFLOW_TEMPLATES } from "../src/modules/workflow/workflow.templates.js";
import "../src/modules/workflow/workflowActions.js";

describe("Validation workflow template", () => {
  const template = WORKFLOW_TEMPLATES.find((item) => item.key === "validation");

  it("is offered with the manufacturing validation steps, in order", async () => {
    expect(template?.name).toBe("Validation");
    expect(template?.module).toBe("validation");

    let result: WorkflowExecutionResult = await executeWorkflow(template!.definition, {}, { triggerKind: "started" });
    const signedOff: string[] = [];
    while (result.status === "waiting_approval") {
      const pending = result.context.pendingApproval as { label?: string };
      signedOff.push(pending.label ?? "");
      result = await resumeWorkflow(template!.definition, result.state, result.context, "approved");
    }

    expect(signedOff).toEqual([
      "Validation Plan/Protocol drafted",
      "Protocol review & approval",
      "IQ (Installation Qualification)",
      "OQ (Operational Qualification)",
      "PQ (Performance Qualification)",
      "Deviations recorded/resolved",
      "Validation Report written",
      "Final review & approval/release",
    ]);
    expect(result.status).toBe("completed");
  });

  it("points the Validation Report step at the Validation Reports folder", async () => {
    let result = await executeWorkflow(template!.definition, {}, { triggerKind: "started" });
    let report: { label?: string; message?: string; documentFolder?: string } | undefined;
    while (result.status === "waiting_approval") {
      const pending = result.context.pendingApproval as { label?: string; message?: string; documentFolder?: string };
      if (pending.label === "Validation Report written") report = pending;
      result = await resumeWorkflow(template!.definition, result.state, result.context, "approved");
    }
    expect(report?.documentFolder).toBe("/folders/validation-reports");
    expect(report?.message).toContain("/folders/validation-reports");
  });

  it("stops when a step is rejected", async () => {
    const result = await executeWorkflow(template!.definition, {}, { triggerKind: "started" });
    expect(result.status).toBe("waiting_approval");
    const stopped = await resumeWorkflow(template!.definition, result.state, result.context, "rejected");
    expect(stopped.status).toBe("completed");
    expect(stopped.context.pendingApproval).toBeUndefined();
  });
});
