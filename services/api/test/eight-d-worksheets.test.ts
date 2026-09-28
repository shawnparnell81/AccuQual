import { describe, expect, it } from "vitest";
import { updateEightDSchema } from "../src/modules/eight-d/eight-d.validation.js";

describe("8D worksheet columns", () => {
  it("accepts each sheet's cells without changing the existing report data", () => {
    const parsed = updateEightDSchema.parse({
      data: { customer: "Titan", problemStatement: "Holes oversized" },
      problemDescriptionD2: { E9: "Housing", F9: "Cover" },
      problemSolvingWorksheetD4: { L10: "Worn die", G10: "New supplier" },
      testingPossibleCausesD4: { E15: "+" },
      decisionMaking: { E23: "10", H23: "8" },
      riskAnalysis: { G8: "If the sort misses a part, then the customer sees it", H8: "4", I8: "9" },
      planProblemPrevention: { C12: "Update the control plan", G12: "8", H12: "6" },
    });
    expect(parsed.data?.customer).toBe("Titan");
    expect(parsed.problemDescriptionD2?.E9).toBe("Housing");
    expect(parsed.decisionMaking?.H23).toBe("8");
    expect(parsed.planProblemPrevention?.G12).toBe("8");
  });

  it("still accepts a save that only updates the Blank 8D boxes", () => {
    const parsed = updateEightDSchema.parse({ data: { champion: "Ada" } });
    expect(parsed.problemDescriptionD2).toBeUndefined();
    expect(parsed.data?.champion).toBe("Ada");
  });
});
