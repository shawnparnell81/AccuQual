import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ELECTRIC_LIFT_FORM as form, BAND_ROWS } from "./forms/electric_lift.ts";
import { showValue } from "./engine.ts";
import type { Cells } from "./formModule.ts";

const text = (values: ReturnType<typeof form.evaluate>, addr: string) => showValue(values[addr]);
const run = (cells: Cells) => form.evaluate({ ...form.blank(), ...cells });

/** Band rows 14-22 and 40-42: drawing 100, tolerance 2, OE (G) and Gaci (H) inside 98..102. */
const BANDED = [14, 15, 16, 17, 18, 19, 20, 21, 22, 40, 41, 42];

/** A complete passing sheet: every row the B53 rollup counts reads Pass. */
function passing(): Cells {
  const cells: Cells = { ...form.blank() };
  for (const row of BANDED) Object.assign(cells, { [`B${row}`]: 100, [`C${row}`]: 2, [`D${row}`]: 2, [`G${row}`]: 100, [`H${row}`]: 101 });
  cells.B22 = 70;
  cells.G22 = 70;
  cells.H22 = 71;
  cells.C22 = 2.5;
  cells.D22 = 2.5;
  for (const row of BAND_ROWS) Object.assign(cells, { [`B${row}`]: 10, [`C${row}`]: 1, [`D${row}`]: 1, [`G${row}`]: 10, [`H${row}`]: 10.5 });
  Object.assign(cells, { G12: 5, H12: 5, B12: 5, C12: 1, D12: 1 });
  Object.assign(cells, { G13: "One Piece Rubber", H13: "One Piece Rubber" });
  for (const col of ["G", "H"]) cells[`${col}29`] = "Yes";
  Object.assign(cells, { G33: 100, G34: 101, H33: 100, H34: 101 });
  Object.assign(cells, { G39: 50, H39: 60 });
  Object.assign(cells, { B43: "graph", G43: "x", H43: "y" });
  Object.assign(cells, { C48: "Yes", C49: "Yes" });
  return cells;
}

describe("FRM-VAL-004 electric lift: the workbook, ported", () => {
  it("is Rev C with the signature slot, the graph spec and a manual deviation tick", () => {
    assert.equal(form.def.revision, "C");
    assert.equal(form.def.docId, "FRM-VAL-004");
    assert.deepEqual(form.def.signatures?.map((slot) => [slot.addr, slot.path]), [["B54", "authorizedSignature"]]);
    assert.equal(form.def.graph?.xLabel, "Displacement (mm)");
    assert.equal(form.def.graph?.yLabel, "Force (N)");
    assert.deepEqual(form.def.graph?.fields, ["File", "Run", "Notes", "SpringFreeHeight", "ReportedRateEndPoint", "Rate", "SpringContactDisplacement", "ReportedRateStartPoint"]);
    assert.equal(form.kinds.D53, "tick");
    assert.equal(form.kinds.G2, "blocked");
    assert.equal(form.kinds.H2, "blocked");
    assert.equal(form.formulas.D53, undefined);
  });

  it("E and F are B-C and B+D on the banded rows", () => {
    const values = run({ B14: 50, C14: 1, D14: 3 });
    assert.equal(values.E14, 49);
    assert.equal(values.F14, 53);
  });

  it("Further Evaluation when a min or max is NA; Fail when OE or Gaci is blank; Pass only when both are inside", () => {
    assert.equal(text(run({ B14: 50, C14: 1, D14: 1, G14: 50, H14: 51 }), "I14"), "Pass");
    assert.equal(text(run({ B14: 50, C14: 1, D14: 1, G14: 50, H14: 53 }), "I14"), "Fail");
    assert.equal(text(run({ B14: 50, C14: 1, D14: 1, G14: 52 }), "I14"), "Fail");
    assert.equal(text(run({ B14: 50, C14: 1, D14: 1, G14: 49.5, H14: 49 }), "I14"), "Pass");
    // "NA" in the min tolerance makes B-C an error; typed NA in B-C reads through a text min.
    const values = form.evaluate({ ...form.blank(), B14: 50, C14: 1, D14: 1, G14: 50, H14: 50, E14: "NA" });
    assert.equal(values.E14, 49, "E14 is a formula, a typed value does not replace it");
  });

  it("I13 passes when the OE grommet style is filled and the Gaci style matches it", () => {
    assert.equal(text(run({ G13: "All Plastic", H13: "All Plastic" }), "I13"), "Pass");
    assert.equal(text(run({ G13: "All Plastic", H13: "One Piece Rubber" }), "I13"), "Fail");
    assert.equal(text(run({ H13: "All Plastic" }), "I13"), "Fail");
    assert.deepEqual(form.lists.G13, ["One Piece Rubber", "Rubber Overmolded Plastic", "All Plastic"]);
  });

  it("I29 needs Yes in both the OE and Gaci pinout", () => {
    assert.equal(text(run({ G29: "Yes", H29: "Yes" }), "I29"), "Pass");
    assert.equal(text(run({ G29: "Yes", H29: "No" }), "I29"), "Fail");
    assert.deepEqual(form.lists.D29, ["Yes", "No"]);
  });

  it("Hall sensors: all four readings and the 3% checks", () => {
    assert.equal(text(run({ G33: 1000, G34: 1020, H33: 1010, H34: 1030 }), "I33"), "Pass");
    assert.equal(text(run({ G33: 1000, G34: 1020, H33: 1010, H34: 1030 }), "I34"), "Pass");
    assert.equal(text(run({ G33: 1000, G34: 1020, H33: 1040, H34: 1040 }), "I33"), "Fail", "Gaci 4% above OE");
    assert.equal(text(run({ G33: 1000, G34: 1040, H33: 1000, H34: 1000 }), "I34"), "Fail", "OE hall 2 is 4% off hall 1");
    assert.equal(text(run({ G33: 1000, G34: 1020, H33: 1000 }), "I33"), "Fail", "needs all four");
    assert.equal(text(run({ G33: 1000, G34: 1030, H33: 1000, H34: 1030 }), "I33"), "Pass", "exactly 3% is inside");
  });

  it("I39 locked rotor force: Gaci must be higher than OE", () => {
    assert.equal(text(run({ G39: 50, H39: 60 }), "I39"), "Pass");
    assert.equal(text(run({ G39: 50, H39: 50 }), "I39"), "Fail");
    assert.equal(text(run({ G39: 50 }), "I39"), "Fail");
  });

  it("I43 needs the drawing graph, the OE graph and the Gaci graph filled in", () => {
    assert.equal(text(run({ B43: "a", G43: "b", H43: "c" }), "I43"), "Pass");
    assert.equal(text(run({ B43: "a", H43: "c" }), "I43"), "Fail");
  });

  it("spring rate = (F4 - F3) / (stroke - 20), for the drawing, OE and Gaci columns", () => {
    const values = run({ B40: 10, B41: 30, B22: 70, G40: 12, G41: 34, G22: 70, H40: 11, H41: 32, H22: 70 });
    assert.equal(values.B44, 0.4);
    assert.equal(values.G44, 0.44);
    assert.equal(values.H44, 0.42);
    assert.equal(text(values, "I44"), "Pass", "0.44 is within 10% of 0.4");
    assert.equal(text(run({ B40: 10, B41: 30, B22: 70, G40: 12, G41: 40, G22: 70, H40: 11, H41: 32, H22: 70 }), "I44"), "Fail");
    assert.equal(text(run({ B40: 10, B41: 30, B22: 70 }), "I44"), "Fail", "needs all three rates");
  });

  it("the visual checks pass on Yes", () => {
    assert.equal(text(run({ C48: "Yes" }), "D48"), "Pass");
    assert.equal(text(run({ C49: "No" }), "D49"), "Fail");
  });
});

describe("FRM-VAL-004 electric lift: the min/max band on I12, I26, I27, I28 and I38", () => {
  for (const row of BAND_ROWS) {
    it(`row ${row}: inside E..F passes, outside fails, blank sample fails`, () => {
      const base = { [`B${row}`]: 10, [`C${row}`]: 1, [`D${row}`]: 2, [`E${row}`]: 9, [`F${row}`]: 12, [`G${row}`]: 10 };
      assert.equal(text(run({ ...base, [`H${row}`]: 11.5 }), `I${row}`), "Pass");
      assert.equal(text(run({ ...base, [`H${row}`]: 12.5 }), `I${row}`), "Fail");
      assert.equal(text(run({ ...base, [`H${row}`]: 8.9 }), `I${row}`), "Fail");
      assert.equal(text(run({ ...base, [`H${row}`]: 9 }), `I${row}`), "Pass", "the min itself is inside");
      assert.equal(text(run(base), `I${row}`), "Fail", "no Gaci value");
      assert.equal(text(run({ ...base, [`G${row}`]: "", [`H${row}`]: 10 }), `I${row}`), "Fail", "no OE value");
    });

    it(`row ${row}: with E or F left blank, the band comes from B-C and B+D`, () => {
      const base = { [`B${row}`]: 10, [`C${row}`]: 1, [`D${row}`]: 2, [`G${row}`]: 10 };
      assert.equal(text(run({ ...base, [`H${row}`]: 11.9 }), `I${row}`), "Pass");
      assert.equal(text(run({ ...base, [`H${row}`]: 12.1 }), `I${row}`), "Fail");
      assert.equal(text(run({ ...base, [`H${row}`]: 8.9 }), `I${row}`), "Fail");
    });

    it(`row ${row}: without B, C and D the workbook's "value entered" check stays`, () => {
      assert.equal(text(run({ [`G${row}`]: 5, [`H${row}`]: 900 }), `I${row}`), "Pass");
      assert.equal(text(run({ [`B${row}`]: 5, [`C${row}`]: 1, [`G${row}`]: 5, [`H${row}`]: 900 }), `I${row}`), "Pass", "D missing");
      assert.equal(text(run({ [`G${row}`]: 5 }), `I${row}`), "Fail");
      assert.equal(text(run({}), `I${row}`), "Fail");
    });
  }
});

describe("FRM-VAL-004 electric lift: rollups", () => {
  it("B51 reads Ready For Gaci Sample once all 23 OE values are in, and is blank before", () => {
    const cells = passing();
    assert.equal(text(run(cells), "B51"), "Ready For Gaci Sample");
    delete cells.G20;
    assert.equal(text(run(cells), "B51"), "");
    assert.equal(text(run({}), "B51"), "");
  });

  it("B53 counts 25 Passes and reads APPROVED, else Fail; the header status follows it", () => {
    const passed = run(passing());
    assert.equal(text(passed, "B53"), "APPROVED");
    assert.equal(form.status(passed), "Pass");
    const cells = passing();
    cells.H20 = 150;
    const failed = run(cells);
    assert.equal(text(failed, "I20"), "Fail");
    assert.equal(text(failed, "B53"), "Fail");
    assert.equal(form.status(failed), "Fail");
    assert.equal(text(run({}), "B53"), "Fail");
  });

  it("a row that reads Further Evaluation is not a Pass, so B53 stays Fail (as in the workbook)", () => {
    const cells = passing();
    cells.B14 = "NA";
    const values = run(cells);
    assert.notEqual(text(values, "I14"), "Pass");
    assert.equal(text(values, "B53"), "Fail");
  });

  it("I44 (spring rate) is not counted in B53", () => {
    const cells = passing();
    // Rates far apart (0 for OE, 0.04 for the drawing and Gaci): I44 fails but every counted row still passes.
    Object.assign(cells, { B40: 100, B41: 102, G40: 100, G41: 100, H40: 100, H41: 102 });
    const values = run(cells);
    assert.equal(text(values, "I44"), "Fail");
    assert.equal(text(values, "I40"), "Pass");
    assert.equal(text(values, "B53"), "APPROVED");
  });

  it("the workbook's conditional formats color G2/H2 and B51 from the rollups", () => {
    const cells = passing();
    const values = run(cells);
    assert.equal(form.conditionalStyle("G2", values, cells)?.bg, "#00B050");
    assert.equal(form.conditionalStyle("H2", values, cells)?.bg, undefined);
    assert.equal(form.conditionalStyle("B51", values, cells)?.bg, "#00B050");
    const blank = run({});
    assert.equal(form.conditionalStyle("H2", blank, {})?.bg, "#FF0000");
    assert.equal(form.conditionalStyle("G2", blank, {})?.bg, undefined);
  });
});
