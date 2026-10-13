import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BRAKE_WEAR_FORM as form } from "./forms/brake_wear.ts";
import { showValue } from "./engine.ts";
import { readWorkbookSample, sameValue } from "./workbookSample.ts";
import type { Cells } from "./formModule.ts";

const text = (values: ReturnType<typeof form.evaluate>, addr: string) => showValue(values[addr]);

/** A passing sheet: every sample on its nominal, every Y/N a Y. */
function passing(): Cells {
  return { ...form.blank(), G12: 570, G13: 11, G14: 11, G15: 8.9, G16: 0, G17: 14, G18: 9.8, G22: "Y", G23: "Y", G24: "Y" };
}

describe("FRM-VAL-009 brake wear: the workbook, ported", () => {
  it("is FRM-VAL-009 Rev A, drawn from the workbook layout", () => {
    assert.equal(form.def.revision, "A");
    assert.equal(form.def.docId, "FRM-VAL-009");
    assert.equal(form.def.layout.merges.length, 40);
  });

  it("every formula gives the result Excel stored, filled with the workbook's own values", async () => {
    const sample = await readWorkbookSample("FRM-VAL-009-Brake-Wear-Sensor-RevA.xlsx");
    const values = form.evaluate(sample.constants);
    for (const [at, expected] of Object.entries(sample.cached)) if (form.formulas[at]) assert.ok(sameValue(values[at], expected), at);
  });

  it("Min and Max are Nominal -/+ Tolerance", () => {
    const values = form.evaluate(form.blank());
    assert.equal(values.E12, 555);
    assert.equal(values.F12, 585);
    assert.equal(values.E13, 10.5);
    assert.equal(values.F13, 11.5);
  });

  it("a dimension passes between Min and Max inclusive and fails outside", () => {
    const values = form.evaluate({ ...form.blank(), G12: 555, G13: 11.5, G14: 11.6, G15: 8.3, G17: 13.5 });
    assert.equal(text(values, "H12"), "Pass");
    assert.equal(text(values, "H13"), "Pass");
    assert.equal(text(values, "H14"), "Fail");
    assert.equal(text(values, "H15"), "Fail");
    assert.equal(text(values, "H17"), "Pass");
  });

  it("the NA rule: a nominal of NA passes whatever the sample", () => {
    // IF(OR(B13="NA"),"Pass",...) with a nominal typed over the constant.
    const values = form.evaluate({ ...form.blank(), B13: "NA", G13: 999 });
    assert.equal(text(values, "H13"), "Pass");
  });

  it("the Y/N checks pass on Y only (blank and N fail, as the workbook has it)", () => {
    const values = form.evaluate({ ...form.blank(), G22: "Y", G23: "N" });
    assert.equal(text(values, "H22"), "Pass");
    assert.equal(text(values, "H23"), "Fail");
    assert.equal(text(values, "H24"), "Fail");
    assert.deepEqual(form.lists.G22, ["Y", "N"]);
  });

  it("row 16 (open question): nominal 0 and tolerance 0 mean only a sample of 0 passes", () => {
    assert.equal(form.def.layout.cells.B16!.v, 0);
    assert.equal(form.def.layout.cells.D16!.v, 0);
    assert.equal(text(form.evaluate({ ...form.blank(), G16: 0 }), "H16"), "Pass");
    assert.equal(text(form.evaluate({ ...form.blank(), G16: 0.1 }), "H16"), "Fail");
  });
});

describe("FRM-VAL-009 brake wear: rollups B27 and J2", () => {
  it("a passing sheet is Pass in B27 and J2, and the header status is Pass", () => {
    const values = form.evaluate(passing());
    assert.equal(text(values, "B27"), "Pass");
    assert.equal(text(values, "J2"), "Pass");
    assert.equal(form.status(values), "Pass");
  });

  it("any failing row, or a missing one, makes it Fail", () => {
    const bad = passing();
    bad.G14 = 99;
    assert.equal(text(form.evaluate(bad), "B27"), "Fail");
    const noCheck = passing();
    delete noCheck.G24;
    assert.equal(text(form.evaluate(noCheck), "J2"), "Fail");
    assert.equal(form.status(form.evaluate(noCheck)), "Fail");
  });

  it("a blank sheet reads Fail, as the workbook does (nothing is measured)", () => {
    assert.equal(text(form.evaluate(form.blank()), "J2"), "Fail");
  });

  it("the header badge reads J2 and the Pass/Fail fills follow the workbook's conditional formats", () => {
    assert.deepEqual(form.def.resultCells, ["J2", "B27"]);
    const cells = passing();
    assert.equal(form.conditionalStyle("J2", form.evaluate(cells), cells)?.bg, "#00B050");
    cells.G12 = 0;
    assert.equal(form.conditionalStyle("H12", form.evaluate(cells), cells)?.bg, "#FF0000");
  });

  it("an empty required input shows yellow, like the workbook", () => {
    const blank = form.blank();
    assert.equal(form.conditionalStyle("G12", form.evaluate(blank), blank)?.bg, "#FFFF00");
    const filled = { ...blank, G12: 570 };
    assert.equal(form.conditionalStyle("G12", form.evaluate(filled), filled)?.bg, undefined);
  });
});

describe("FRM-VAL-009 brake wear: section 5 Further Review and editing", () => {
  it("the Further Review Pass/Fail (B34) is a manual Pass/Fail dropdown", () => {
    assert.equal(form.kinds.B34, "select");
    assert.deepEqual(form.lists.B34, ["Pass", "Fail"]);
    assert.equal(form.formulas.B34, undefined);
  });

  it("FINAL DISPOSITION ticks stay manual tick boxes in both sections", () => {
    for (const addr of ["C28", "E28", "H28", "C35", "E35", "H35"]) assert.equal(form.kinds[addr], "check", addr);
  });

  it("the signatures sit on B29 and B36 with the old certification text", () => {
    assert.deepEqual(form.def.signatures?.map((s) => [s.addr, s.path]), [["B29", "authorizedSignature"], ["B36", "furtherSignature"]]);
    assert.equal(form.kinds.B29, "signature");
    assert.equal(form.kinds.B36, "signature");
  });

  it("people fill the part, supplier, sample and note cells; nominals and tolerances are fixed", () => {
    for (const addr of ["B6", "B7", "G6", "G7", "G8", "G12", "G18", "B37"]) assert.equal(form.kinds[addr], "input", addr);
    assert.equal(form.kinds.B8, "select");
    for (const addr of ["B12", "D12", "B22"]) assert.equal(form.kinds[addr], "label", addr);
    assert.equal(form.blank().B8, "Shawn Parnell");
  });
});
