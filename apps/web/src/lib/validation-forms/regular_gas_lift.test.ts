import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { showValue } from "./engine.ts";
import type { Cells } from "./formModule.ts";
import { GAS_LIFT_REGULAR_DOC_ID, REGULAR_GAS_LIFT_FORM as form } from "./forms/regular_gas_lift.ts";

const text = (values: ReturnType<typeof form.evaluate>, addr: string) => showValue(values[addr]);
const run = (cells: Cells) => form.evaluate({ ...form.blank(), ...cells });

/** Every required row answered and passing. Typed-spec rows (13, 24-27) are left blank on purpose. */
function passing(): Cells {
  return {
    C12: 369, C14: 126.5, C15: 18.1, C16: 7.9, C17: "17mm/10mm ball", C18: "22MM/10MM BALL ", C23: 195,
    C28: "Y", C29: "N", C34: "Yes", C35: "Yes", C36: "Yes", C37: "Yes",
  };
}

describe("FRM-VAL-012 regular gas lift: the form", () => {
  it("is Rev A, FRM-VAL-012 (one constant), with its Doc ID and Rev cells", () => {
    assert.equal(form.def.revision, "A");
    assert.equal(GAS_LIFT_REGULAR_DOC_ID, "FRM-VAL-012");
    assert.equal(form.def.docId, GAS_LIFT_REGULAR_DOC_ID);
    assert.equal(form.def.docIdCell, "A2");
    assert.equal(form.def.revCell, "B2");
    assert.equal(form.def.type, "regular_gas_lift");
  });

  it("keeps the workbook's layout and adds a result cell in a new column F beside FINAL DISPOSITION", () => {
    const layout = form.def.layout;
    assert.equal(layout.sheet.startsWith("FRM-VAL-005"), true);
    assert.equal(layout.merges.length, 17);
    assert.equal(layout.images.length, 1);
    assert.equal(layout.cells.A39?.v, "FINAL DISPOSITION:");
    assert.equal(layout.maxCol, 6);
    assert.equal(layout.cols.length, 6);
    assert.equal(layout.cells.F38?.v, "RESULT");
    assert.equal(form.kinds.F39, "calc");
    assert.deepEqual(form.def.resultCells, ["F39"]);
  });

  it("has the dropdowns: Y/N on rows 28-29, Yes/No on rows 34-37", () => {
    for (const row of [28, 29]) {
      assert.deepEqual(form.lists[`C${row}`], ["Y", "N"]);
      assert.equal(form.kinds[`C${row}`], "select");
    }
    for (const row of [34, 35, 36, 37]) {
      assert.deepEqual(form.lists[`C${row}`], ["Yes", "No"]);
      assert.equal(form.kinds[`C${row}`], "select");
    }
  });

  it("the section bands are not inputs, the typed-spec cells are, and the signature and graph are declared", () => {
    for (const addr of ["A4", "A9", "A20", "A31", "A38"]) assert.ok(form.kinds[addr] !== "input", addr);
    for (const addr of ["B13", "B24", "B25", "B26", "B27"]) assert.equal(form.kinds[addr], "input", addr);
    assert.equal(form.kinds.D39, "tick");
    assert.equal(form.def.signatures?.[0]?.addr, "B40");
    assert.equal(form.def.signatures?.[0]?.path, "authorizedSignature");
    assert.deepEqual(form.def.graph?.fields.length, 8);
    assert.equal(form.def.graph?.xLabel, "Displacement (mm)");
    assert.equal(form.def.graph?.yLabel, "Force (N)");
  });

  it("B13 starts as the workbook's 243 and typed specs live in the saved cells", () => {
    assert.equal(form.blank().B13, 243);
    const cells = form.cellsFromData({ cells: { B13: "243 +/-2", B24: "195 +20/-10" } });
    assert.equal(cells.B13, "243 +/-2");
    assert.equal(cells.B24, "195 +20/-10");
  });
});

describe("FRM-VAL-012 regular gas lift: C27 is the workbook's average", () => {
  it("C27 = AVERAGE(C23:C26)", () => {
    assert.equal(form.formulas.C27, "AVERAGE(C23:C26)");
    assert.equal(run({ C23: 190, C24: 200, C25: 210, C26: 200 }).C27, 200);
    assert.equal(run({ C23: 100, C26: 200 }).C27, 150);
  });
});

describe("FRM-VAL-012 regular gas lift: D rules", () => {
  it("rows 12, 14, 15, 16 and 23 pass inside the OE range and fail outside it", () => {
    const cases: [number, number, number, number][] = [
      [12, 367, 371, 371.5],
      [14, 125.5, 127.5, 128],
      [15, 17.8, 18.2, 18.3],
      [16, 7.8, 8.2, 7.7],
      [23, 185, 215, 216],
    ];
    for (const [row, low, high, outside] of cases) {
      assert.equal(text(run({ [`C${row}`]: low }), `D${row}`), "Pass", `D${row} at ${low}`);
      assert.equal(text(run({ [`C${row}`]: high }), `D${row}`), "Pass", `D${row} at ${high}`);
      assert.equal(text(run({ [`C${row}`]: outside }), `D${row}`), "Fail", `D${row} at ${outside}`);
    }
  });

  it("a blank or non-numeric measurement gives a blank result", () => {
    for (const row of [12, 14, 15, 16, 23]) {
      assert.equal(text(run({}), `D${row}`), "");
      assert.equal(text(run({ [`C${row}`]: "n/a" }), `D${row}`), "");
    }
  });

  it("connector style rows pass when C matches B, ignoring case and end spaces", () => {
    assert.equal(text(run({ C17: "17MM/10MM BALL" }), "D17"), "Pass");
    assert.equal(text(run({ C17: "  17mm/10mm ball  " }), "D17"), "Pass");
    assert.equal(text(run({ C17: "17mm/12mm ball" }), "D17"), "Fail");
    assert.equal(text(run({ C18: "22mm/10mm Ball" }), "D18"), "Pass");
    assert.equal(text(run({ C18: "17mm/10mm ball" }), "D18"), "Fail");
    assert.equal(text(run({}), "D17"), "");
  });

  it("row 19 (N/A) is Pass", () => {
    assert.equal(text(run({}), "D19"), "Pass");
    assert.equal(text(run({ C19: 3.2 }), "D19"), "Pass");
  });

  it("rows 28 and 29 pass when C equals B (Y and N)", () => {
    assert.equal(text(run({ C28: "Y" }), "D28"), "Pass");
    assert.equal(text(run({ C28: "N" }), "D28"), "Fail");
    assert.equal(text(run({ C29: "N" }), "D29"), "Pass");
    assert.equal(text(run({ C29: "Y" }), "D29"), "Fail");
    assert.equal(text(run({}), "D28"), "");
    assert.equal(text(run({}), "D29"), "");
  });

  it("rows 34-37 pass on Yes and fail on No", () => {
    for (const row of [34, 35, 36, 37]) {
      assert.equal(text(run({ [`C${row}`]: "Yes" }), `D${row}`), "Pass");
      assert.equal(text(run({ [`C${row}`]: "No" }), `D${row}`), "Fail");
      assert.equal(text(run({}), `D${row}`), "");
    }
  });
});

describe("FRM-VAL-012 regular gas lift: rows with no spec on the form", () => {
  it("row 13: the workbook's plain 243 has no tolerance, so D stays blank until a range is typed", () => {
    assert.equal(text(run({ C13: 243 }), "D13"), "");
    assert.equal(text(run({ C13: 243, B13: "243 +/-2" }), "D13"), "Pass");
    assert.equal(text(run({ C13: 246, B13: "243 +/-2" }), "D13"), "Fail");
  });

  it("rows 24-26 take a typed target with a tolerance, an asymmetric one, or a min and max", () => {
    for (const row of [24, 25, 26]) {
      assert.equal(text(run({ [`B${row}`]: "195 +/-10", [`C${row}`]: 200 }), `D${row}`), "Pass");
      assert.equal(text(run({ [`B${row}`]: "195 +20/-10", [`C${row}`]: 214 }), `D${row}`), "Pass");
      assert.equal(text(run({ [`B${row}`]: "195 +20/-10", [`C${row}`]: 184 }), `D${row}`), "Fail");
      assert.equal(text(run({ [`B${row}`]: "min 185 max 215", [`C${row}`]: 190 }), `D${row}`), "Pass");
      assert.equal(text(run({ [`B${row}`]: "185-215", [`C${row}`]: 220 }), `D${row}`), "Fail");
    }
  });

  it("D calculates as soon as both are filled, and shows nothing while either is blank or the spec is unreadable", () => {
    assert.equal(text(run({ B24: "195 +/-10" }), "D24"), "");
    assert.equal(text(run({ C24: 200 }), "D24"), "");
    assert.equal(text(run({ B24: "about 195", C24: 200 }), "D24"), "");
    assert.equal(text(run({ B24: "195", C24: 200 }), "D24"), "");
    assert.equal(text(run({ B24: 195, C24: 195 }), "D24"), "");
  });

  it("row 27 judges the average (C27) against its typed spec", () => {
    assert.equal(text(run({ B27: "200 +/-5", C23: 198, C24: 202 }), "D27"), "Pass");
    assert.equal(text(run({ B27: "200 +/-5", C23: 150, C24: 160 }), "D27"), "Fail");
    assert.equal(text(run({ B27: "200 +/-5" }), "D27"), "", "no force readings yet, so no average to judge");
    assert.equal(text(run({ C23: 198, C24: 202 }), "D27"), "", "no target typed");
  });
});

describe("FRM-VAL-012 regular gas lift: the overall result and the ticks", () => {
  it("is blank until every required row has a result", () => {
    assert.equal(text(run({}), "F39"), "");
    const partial = passing();
    delete partial.C37;
    const values = run(partial);
    assert.equal(text(values, "F39"), "");
    assert.equal(form.status(values), "");
    assert.equal(text(values, "B39"), "[ ] APPROVED");
    assert.equal(text(values, "C39"), "[ ] REJECTED");
  });

  it("is Pass when every required row passes, and ticks APPROVED", () => {
    const values = run(passing());
    assert.equal(text(values, "F39"), "Pass");
    assert.equal(form.status(values), "Pass");
    assert.equal(text(values, "B39"), "[X] APPROVED");
    assert.equal(text(values, "C39"), "[ ] REJECTED");
  });

  it("is Fail when any row fails, and ticks REJECTED", () => {
    for (const bad of [{ C12: 380 }, { C17: "wrong" }, { C28: "N" }, { C36: "No" }]) {
      const values = run({ ...passing(), ...bad });
      assert.equal(text(values, "F39"), "Fail", JSON.stringify(bad));
      assert.equal(form.status(values), "Fail");
      assert.equal(text(values, "B39"), "[ ] APPROVED");
      assert.equal(text(values, "C39"), "[X] REJECTED");
    }
  });

  it("a typed-spec row with no result is left out, and one that fails fails the form", () => {
    assert.equal(text(run({ ...passing(), B24: "195 +/-10" }), "F39"), "Pass", "spec typed, no measurement: left out");
    assert.equal(text(run({ ...passing(), B24: "195 +/-10", C24: 200 }), "F39"), "Pass");
    assert.equal(text(run({ ...passing(), B24: "195 +/-10", C24: 250 }), "F39"), "Fail");
    assert.equal(text(run({ ...passing(), B13: "243 +/-2", C13: 250 }), "F39"), "Fail");
  });

  it("APPROVED WITH DEVIATION stays a manual tick, independent of the result", () => {
    assert.equal(form.kinds.D39, "tick");
    assert.equal(form.formulas.D39, undefined);
    assert.equal(form.formulas.B39 !== undefined && form.formulas.C39 !== undefined, true);
  });

  it("the Pass/Fail words use the form's own fills", () => {
    const cells = { ...form.blank(), ...passing() };
    const values = form.evaluate(cells);
    assert.equal(text(values, "D12"), "Pass");
    assert.equal(form.def.words.pass, "Pass");
    assert.equal(form.def.words.fail, "Fail");
  });
});
