import { describe, expect, it } from "vitest";
import { cellLabel, formDataEdits } from "../../src/modules/forms/formEditAudit.js";

describe("NCR form field audit", () => {
  it("names each saved field and the old and new values, including the first save", () => {
    expect(cellLabel("ncrNumber")).toBe("NCR Number");
    expect(cellLabel("nonconformanceDescription")).toBe("Nonconformance Description");

    const first = formDataEdits(
      {},
      {
        ncrNumber: "TEST-1008-01",
        nonconformanceDescription: "Hole oversize",
        _formTemplate: { version: 1, revision: "A" },
      },
    );
    expect(first).toEqual(
      expect.arrayContaining([
        { label: "NCR Number", from: "(blank)", to: "TEST-1008-01" },
        { label: "Nonconformance Description", from: "(blank)", to: "Hole oversize" },
      ]),
    );
    expect(first.some((edit) => edit.label.includes("Form Template"))).toBe(false);

    const second = formDataEdits(
      { ncrNumber: "TEST-1008-01", nonconformanceDescription: "Hole oversize", _formTemplate: { version: 1 } },
      { ncrNumber: "TEST-1008-01", nonconformanceDescription: "Hole oversize after the edit", _formTemplate: { version: 1 } },
    );
    expect(second).toEqual([{ label: "Nonconformance Description", from: "Hole oversize", to: "Hole oversize after the edit" }]);
  });

  it("reads a classification checkbox as the selected word", () => {
    const edits = formDataEdits(
      {},
      { ncrClassification: [{ classification: { Minor: false, Major: true, Critical: false } }] },
    );
    expect(edits).toContainEqual({
      label: "NCR Classification 1 Classification",
      from: "(blank)",
      to: "Major",
    });
    expect(edits.some((edit) => edit.from === "(blank)" && edit.to === "(blank)")).toBe(false);
  });
});
