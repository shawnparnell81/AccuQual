import { describe, expect, it } from "vitest";
import { isBlank, missingRequiredLabels, moveNeedsRequiredFields, requiredMoveMessage } from "../src/modules/workflow/requiredFields.js";

describe("required field messages", () => {
  it("names every empty field", () => {
    expect(requiredMoveMessage(["Root Cause", "Disposition", "Containment Action"])).toBe(
      "Cannot move to the next step. Required fields missing: Root Cause, Disposition, Containment Action.",
    );
    expect(isBlank("  ")).toBe(true);
    expect(isBlank(0)).toBe(false);
    expect(isBlank(false)).toBe(false);
  });

  it("uses the workflow labels and skips a rejection", () => {
    expect(missingRequiredLabels(["root_cause", "corrective_action"], { root_cause: "", corrective_action: "Replace seal" })).toEqual(["Root Cause"]);
    expect(moveNeedsRequiredFields("approved")).toBe(true);
    expect(moveNeedsRequiredFields("rejected")).toBe(false);
  });

  it("names a missing FAI tolerance by characteristic", () => {
    const sortOrder = 25;
    expect(`FAI characteristic ${sortOrder} is missing a required tolerance.`).toBe("FAI characteristic 25 is missing a required tolerance.");
  });
});
