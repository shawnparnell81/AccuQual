import { describe, expect, it } from "vitest";
import { classificationFromForm, classificationLabel, whatHappened } from "../../src/modules/ncr/ncr.listFields.js";

describe("NCR list fields", () => {
  it("shows the form classification and the description's first line", () => {
    const data = {
      nonconformanceDescription: "Hole oversize on the bushing\nThe rest stays off the list",
      ncrClassification: [{ classification: { Minor: false, Major: true, Critical: false } }],
    };
    expect(classificationFromForm(data)).toBe("Major");
    expect(classificationLabel(data, null)).toBe("Major");
    expect(whatHappened("Nonconformance Report", null, data)).toBe("Hole oversize on the bushing");
    expect(whatHappened("Nonconformance Report", "Record description", {})).toBe("Record description");
    expect(classificationLabel({}, "critical")).toBe("Critical");
  });
});
