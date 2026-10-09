import { describe, expect, it } from "vitest";
import { formDataEdits } from "../../src/modules/forms/formEditAudit.js";
import { updateIsoQualityFormSchema } from "../../src/modules/iso-quality-forms/iso-quality-forms.validation.js";

describe("failure chart saves typed month text", () => {
  it("accepts text in the month headers and the month count cells", () => {
    const parsed = updateIsoQualityFormSchema.safeParse({
      data: {
        cells: {},
        months: ["TEST-1008", "A header longer than forty characters is still a label", "Mar"],
        problems: [
          {
            claimed: "not a number",
            op: "OP-1",
            problem: "TEST-1008-43 EDIT2",
            pca: "Yes",
            months: ["text", "12", "", null],
          },
        ],
      },
    });
    expect(parsed.success).toBe(true);
  });
});

describe("iso sheet audit diffs", () => {
  it("names a new problem description instead of blank to blank", () => {
    const edits = formDataEdits(
      { problems: [] },
      {
        problems: [{ problem: "TEST-1008-43 EDIT2", claimed: "", op: "", pca: "", months: ["", "2", ""] }],
        months: ["Jan", "Feb", "Mar"],
      },
    );
    expect(edits).toContainEqual({ label: "Problem 1", from: "(blank)", to: "TEST-1008-43 EDIT2" });
    expect(edits).toContainEqual({ label: "Problem 1 Feb", from: "(blank)", to: "2" });
    expect(edits.some((edit) => edit.from === "(blank)" && edit.to === "(blank)")).toBe(false);
  });

  it("lists scorecard cells and ignores a template stamp", () => {
    const edits = formDataEdits(
      { customers: [], _formTemplate: { version: 1, revision: "A", structureHash: "" } },
      {
        customers: [{ name: "Acme", ppmMonth: "3", group: "", band: "customer" }],
        _formTemplate: { version: 2, revision: "B", structureHash: "structure" },
      },
    );
    expect(edits).toContainEqual({ label: "Acme Name", from: "(blank)", to: "Acme" });
    expect(edits).toContainEqual({ label: "Acme Ppm Month", from: "(blank)", to: "3" });
    expect(edits.some((edit) => /template/i.test(edit.label))).toBe(false);
  });
});
