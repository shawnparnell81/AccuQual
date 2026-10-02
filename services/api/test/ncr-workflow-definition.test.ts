import { describe, expect, it } from "vitest";
import {
  NCR_WORKFLOW,
  allowedTransitionKeys,
  canonicalNcrStep,
  decorateNcrBody,
  ncrStatusAliases,
  ncrStepLabel,
  ncrWorkflowView,
} from "../src/modules/ncr/ncr.workflow.js";

describe("NCR workflow definition", () => {
  it("names the six steps in order", () => {
    expect(NCR_WORKFLOW.steps.map((step) => step.name)).toEqual([
      "NCR Created",
      "Contain",
      "Disposition",
      "Fix",
      "Verify",
      "Closed",
    ]);
  });

  it("maps the previous statuses onto the new steps", () => {
    expect(canonicalNcrStep("open")).toBe("ncr_created");
    expect(canonicalNcrStep("contained")).toBe("contain");
    expect(canonicalNcrStep("investigating")).toBe("disposition");
    expect(canonicalNcrStep("corrective_action")).toBe("fix");
    expect(canonicalNcrStep("closed")).toBe("closed");
    expect(ncrStepLabel("corrective_action")).toBe("Fix");
    expect(ncrStepLabel("open")).toBe("NCR Created");
  });

  it("allows only the next step", () => {
    expect(allowedTransitionKeys("ncr_created")).toEqual(["contain"]);
    expect(allowedTransitionKeys("contained")).toEqual(["disposition"]);
    expect(allowedTransitionKeys("verify")).toEqual(["closed"]);
    expect(allowedTransitionKeys("closed")).toEqual([]);
    expect(ncrStatusAliases("open")).toEqual(expect.arrayContaining(["ncr_created", "open"]));
  });

  it("builds currentStep, allowedTransitions, and history for an in-progress NCR", () => {
    const view = ncrWorkflowView({
      status: "investigating",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(view.currentStep).toBe("Disposition");
    expect(view.allowedTransitions).toEqual(["Fix"]);
    expect(view.history.map((entry) => entry.step)).toEqual(["NCR Created", "Contain", "Disposition"]);
    expect(view.history[0]?.at).toBe("2026-01-01T00:00:00.000Z");
    expect(view.history[2]?.at).toBe("2026-01-02T00:00:00.000Z");
  });

  it("rewrites a stored row on read without touching unrelated payloads", () => {
    const decorated = decorateNcrBody({
      id: 4,
      title: "Burr",
      status: "corrective_action",
      containment: "Held the lot",
      createdAt: "2026-01-01T00:00:00.000Z",
    }) as { status: string; workflow: { currentStep: string; allowedTransitions: string[] } };
    expect(decorated.status).toBe("fix");
    expect(decorated.workflow.currentStep).toBe("Fix");
    expect(decorated.workflow.allowedTransitions).toEqual(["Verify"]);
    expect(decorateNcrBody({ message: "On Hold" })).toEqual({ message: "On Hold" });
  });
});
