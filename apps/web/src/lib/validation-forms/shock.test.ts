import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SHOCK_FORM as form } from "./forms/shock.ts";
import { showValue } from "./engine.ts";
import type { Cells } from "./formModule.ts";

const text = (values: ReturnType<typeof form.evaluate>, addr: string) => showValue(values[addr]);

/** A fully filled, passing sheet: every measurement sits on its spec. */
function passing(): Cells {
  const cells: Cells = {
    ...form.blank(),
    C11: 10, E11: 10, F11: 10,
    C15: 400, E15: 401, F15: 399,
    C17: 150, E17: 151, F17: 149,
    E16: 250, F16: 250,
    C18: 25, E18: 30, F18: 28,
    G10: "Passed", H10: "Passed",
  };
  for (const row of [22, 23, 24, 25, 26, 27, 28, 29, 30, 31]) {
    cells[`C${row}`] = 100;
    cells[`D${row}`] = 10;
    cells[`E${row}`] = 105;
    cells[`F${row}`] = 95;
  }
  for (const row of [35, 36, 37, 38]) {
    cells[`C${row}`] = 20;
    cells[`E${row}`] = 20.2;
    cells[`F${row}`] = 19.8;
  }
  return cells;
}

describe("FRM-VAL-002 shock: the workbook, ported", () => {
  it("is Rev B and drawn from the workbook layout", () => {
    assert.equal(form.def.revision, "B");
    assert.equal(form.def.layout.sheet, "Test Report");
    assert.equal(form.def.layout.merges.length, 28);
  });

  it("C16 = C15 - C17 and the minimum-length row follows it", () => {
    const values = form.evaluate({ ...form.blank(), C15: 400, C17: 150, E16: 250, F16: 252, D16: 7 });
    assert.equal(values.C16, 250);
    assert.equal(text(values, "G16"), "Passed");
    assert.equal(text(values, "H16"), "Passed");
  });

  it("row 18 keeps the workbook's E >= C (a minimum thickness)", () => {
    const values = form.evaluate({ ...form.blank(), C18: 25, E18: 25, F18: 24 });
    assert.equal(text(values, "G18"), "Passed");
    assert.equal(text(values, "H18"), "Failed");
  });

  it("the ported band formula passes inside C±D and fails outside it (row 15, row 24, row 29)", () => {
    const values = form.evaluate({ ...form.blank(), C15: 400, D15: 7, E15: 406, F15: 408, C24: 50, D24: 5, E24: 50, F24: 56, C29: 80, D29: 2, E29: 79, F29: 83 });
    assert.equal(text(values, "G15"), "Passed");
    assert.equal(text(values, "H15"), "Failed");
    assert.equal(text(values, "G24"), "Passed");
    assert.equal(text(values, "G29"), "Passed");
  });
});

describe("FRM-VAL-002 shock: workbook bugs fixed", () => {
  it("H11 tests C11±D11, not F11=10", () => {
    // The workbook's H11 = IF(F11=10, ...). With a spec of 8.8 and tolerance 0.5 the sample 9 is good.
    const values = form.evaluate({ ...form.blank(), C11: 8.8, D11: 0.5, E11: 9, F11: 9 });
    assert.equal(text(values, "G11"), "Passed");
    assert.equal(text(values, "H11"), "Passed");
    assert.equal(text(values, "H11"), text(values, "G11"));
  });

  it("H35-H37 use C±D of their own row", () => {
    // The workbook compared F35 with D36±E35 and so on.
    const values = form.evaluate({ ...form.blank(), C35: 20, D35: 0.5, E35: 20.1, F35: 20.4, C36: 30, D36: 0.5, E36: 30, F36: 31, C37: 40, D37: 0.5, E37: 40, F37: 40.2 });
    assert.equal(text(values, "H35"), "Passed");
    assert.equal(text(values, "H36"), "Failed");
    assert.equal(text(values, "H37"), "Passed");
  });

  it("G37 tests E37 on both sides of the band", () => {
    // The workbook tested E37 >= low and F37 <= high.
    const values = form.evaluate({ ...form.blank(), C37: 40, D37: 0.5, E37: 42, F37: 40 });
    assert.equal(text(values, "G37"), "Failed");
    assert.equal(text(values, "H37"), "Passed");
  });
});

describe("FRM-VAL-002 shock: pass/fail added", () => {
  it("rows 22,23,25,26,27,28,30,31 give Passed/Failed in G and H", () => {
    for (const row of [22, 23, 25, 26, 27, 28, 30, 31]) {
      const values = form.evaluate({ ...form.blank(), [`C${row}`]: 100, [`D${row}`]: 10, [`E${row}`]: 108, [`F${row}`]: 120 });
      assert.equal(text(values, `G${row}`), "Passed", `G${row}`);
      assert.equal(text(values, `H${row}`), "Failed", `H${row}`);
    }
  });

  it("H24 and H29, missing in the workbook, grade sample 2 on rows 24 and 29", () => {
    const values = form.evaluate({ ...form.blank(), C24: 50, D24: 5, E24: 50, F24: 70, C29: 80, D29: 2, E29: 80, F29: 80 });
    assert.equal(text(values, "H24"), "Failed");
    assert.equal(text(values, "H29"), "Passed");
  });

  it("a blank measurement, spec or tolerance gives a blank result on the new rows", () => {
    for (const cells of [{}, { C22: 100, D22: 10 }, { E22: 100, D22: 10 }, { C22: 100, E22: 100 }]) {
      const values = form.evaluate({ ...form.blank(), ...cells });
      assert.equal(text(values, "G22"), "");
    }
  });

  it("row 10 takes a Passed/Failed dropdown in G and H", () => {
    assert.deepEqual(form.lists.G10, ["Passed", "Failed"]);
    assert.deepEqual(form.lists.H10, ["Passed", "Failed"]);
    assert.equal(form.kinds.G10, "select");
    assert.equal(form.kinds.H10, "select");
  });

  it("the gray fill is off the cells that now carry a result", () => {
    const styleOf = (addr: string) => form.def.layout.styles[form.def.layout.cells[addr]!.s];
    assert.equal(styleOf("G22")?.bg, undefined);
    assert.equal(styleOf("D22")?.bg, undefined);
    assert.equal(styleOf("G10")?.bg, undefined);
    assert.ok(styleOf("D10")?.bg, "D10 (no tolerance on a visual inspection) stays gray");
    assert.equal(form.kinds.D22, "input");
  });
});

describe("FRM-VAL-002 shock: rollups", () => {
  it("the overall result is blank until every graded row has a result", () => {
    const blank = form.evaluate(form.blank());
    assert.equal(text(blank, "A3"), "");
    const partial = passing();
    delete partial.E31;
    assert.equal(text(form.evaluate(partial), "A3"), "");
    assert.equal(form.status(form.evaluate(partial)), "");
  });

  it("a complete passing sheet is Passed, ticks Pass for both samples and the overall", () => {
    const values = form.evaluate(passing());
    assert.equal(text(values, "A3"), "Passed");
    assert.equal(form.status(values), "Pass");
    assert.equal(values.B41, true);
    assert.equal(values.D41, false);
    assert.equal(values.B42, true);
    assert.equal(values.D42, false);
    assert.equal(values.B43, true);
    assert.equal(values.D43, false);
  });

  it("one failed row makes the sample, and the overall, Failed and ticks Fail", () => {
    const cells = passing();
    cells.F26 = 130; // sample 2 only
    const values = form.evaluate(cells);
    assert.equal(text(values, "H26"), "Failed");
    assert.equal(text(values, "A3"), "Failed");
    assert.equal(values.B41, true, "sample 1 is still good");
    assert.equal(values.D41, false);
    assert.equal(values.B42, false);
    assert.equal(values.D42, true, "sample 2 failed");
    assert.equal(values.B43, false);
    assert.equal(values.D43, true);
    assert.equal(form.status(values), "Fail");
  });

  it("a Failed in the row 10 dropdown fails the sample", () => {
    const cells = passing();
    cells.G10 = "Failed";
    const values = form.evaluate(cells);
    assert.equal(values.D41, true);
    assert.equal(text(values, "A3"), "Failed");
  });

  it("Conditional Pass stays manual: F41, F42 and F43 are plain tick boxes", () => {
    for (const addr of ["F41", "F42", "F43"]) assert.equal(form.kinds[addr], "check");
    assert.equal(form.formulas.F41, undefined);
  });

  it("the Pass/Fail fills follow the workbook's conditional formats", () => {
    const passed = form.evaluate(passing());
    assert.equal(form.conditionalStyle("A3", passed, passing())?.bg, "#4EA72E");
    const cells = passing();
    cells.E15 = 900;
    const failed = form.evaluate(cells);
    assert.equal(form.conditionalStyle("G15", failed, cells)?.bg, "#FF0000");
  });
});
