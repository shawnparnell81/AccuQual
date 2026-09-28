import { describe, expect, it } from "vitest";
import { applyStepCompletion, blank8dFromData, buildSaveData, previousFields, BLANK_8D_LABELS } from "../src/modules/eight-d/blank8dForm.js";
import { renderBlank8DPdf } from "../src/modules/eight-d/blank8d-pdf.js";
import { emptyBlank8D } from "../src/modules/eight-d/blank8dForm.js";

describe("Blank 8D sheet data", () => {
  it("keeps the owner's wording, including the spelling on the sheet", () => {
    expect(BLANK_8D_LABELS.d5).toBe("D5  Choose and Verify Permenant Corrective Action(s) (PCA):");
    expect(BLANK_8D_LABELS.d6).toBe("D6 Implement and Validate Permentant Corrective Action(s) (PCA):");
    expect(BLANK_8D_LABELS.d7).toBe("D7  System Prevention Actions to Prevent Reoccurence:");
    expect(BLANK_8D_LABELS.partNo).toBe("Part No./Code");
    expect(BLANK_8D_LABELS.documentsReviewed).toBe("Have Corrective Action/Implementation Been Reviewed Against Documents:?");
    expect(BLANK_8D_LABELS.procWorkInstr).toBe("Proc./Work Instr.");
  });

  it("copies older step text into the matching box and leaves D1 in previous fields", () => {
    const shown = blank8dFromData({
      d1_team: "Quality Engineering (lead), Purchasing",
      d2_problem: "Holes oversized",
      d8_closure: "Team recognized",
    });
    expect(shown.problemStatement).toBe("Holes oversized");
    expect(shown.recognition).toBe("Team recognized");
    expect(shown.teamMembers).toBe("");

    const earlier = previousFields({
      d1_team: "Quality Engineering (lead), Purchasing",
      d2_problem: "Holes oversized",
      d8_closure: "Team recognized",
    });
    expect(earlier.map((field) => field.label)).toEqual(["D1 — Establish the Team"]);
    expect(earlier[0]?.value).toBe("Quality Engineering (lead), Purchasing");
  });

  it("does not drop an older object or an unrelated key when the sheet is saved", () => {
    const saved = buildSaveData(
      { d1_team: { members: ["Ada"] }, d4_rootCause: { method: "5-Why" }, customNote: "keep me" },
      { ...emptyBlank8D(), rootCauses: "Worn die", recognition: "Thanks" }
    );
    expect(saved.d1_team).toEqual({ members: ["Ada"] });
    expect(saved.d4_rootCause).toEqual({ method: "5-Why" });
    expect(saved.customNote).toBe("keep me");
    expect(saved.rootCauses).toBe("Worn die");
    expect(saved.d8_closure).toBe("Thanks");
    expect(previousFields(saved).map((field) => field.label)).toEqual([
      "D1 — Establish the Team",
      "D4 — Root Cause Analysis",
      "customNote",
    ]);
  });

  it("keeps a previous plain-text D1 when a step is completed", () => {
    const next = applyStepCompletion({ d1_team: "Ada, Ben" }, "d1_team", { champion: "Ada" });
    expect(next.d1_team).toEqual({ champion: "Ada" });
    expect(next.champion).toBe("Ada");
    expect(previousFields(next).some((field) => field.value === "Ada, Ben")).toBe(true);
  });

  it("renders a PDF of the sheet", async () => {
    const bytes = await renderBlank8DPdf({
      id: 12,
      values: { ...emptyBlank8D(), customer: "Titan Components", problemStatement: "Holes oversized" },
    });
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
