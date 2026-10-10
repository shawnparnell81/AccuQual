import { describe, expect, it } from "vitest";
import { formDataEdits, withFormEdits } from "../../src/modules/forms/formEditAudit.js";
import { explicitFileFormKeys, requiresExplicitFile } from "../../src/modules/document-folders/formFiling.js";
import { baselineOnly } from "../../src/modules/forms/templateBaseline.js";

describe("validation demo fixes", () => {
  it("does not log template defaults as the first save", () => {
    expect(baselineOnly("csa", "B12", undefined, 10)).toBe(true);
    expect(baselineOnly("csa", "B8", "", "Shawn Parnell")).toBe(true);
    expect(baselineOnly("csa", "B51", undefined, false)).toBe(true);
    const edits = formDataEdits(
      { formType: "csa", cells: {} },
      { formType: "csa", cells: { B8: "Shawn Parnell", B12: 10, B6: "PN-1", B51: false } },
    );
    expect(edits).toEqual([{ label: "Cell B6", from: "(blank)", to: "PN-1" }]);
    const quiet = withFormEdits({ data: { cells: {} } }, { cells: { B6: "PN-1" } }, { cells: { B6: "PN-1" } });
    expect(quiet.edits).toBeUndefined();
    expect(quiet.data).toBeUndefined();
  });

  it("files validation, ISO, and QMS only from Save as", () => {
    expect(requiresExplicitFile("/validation-reports")).toBe(true);
    expect(requiresExplicitFile("/iso-quality-forms")).toBe(true);
    expect(requiresExplicitFile("/qms-forms")).toBe(true);
    expect(requiresExplicitFile("/ncr")).toBe(false);
    const keys = explicitFileFormKeys();
    expect(keys.has("frm-val-001")).toBe(true);
    expect(keys.has("frm-val-007")).toBe(true);
    expect(keys.has("ncr")).toBe(false);
  });
});
