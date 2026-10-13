import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COIL_SPRING_FORM as form } from "./forms/coil_spring.ts";
import { showValue } from "./engine.ts";
import type { Cells } from "./formModule.ts";

const text = (values: ReturnType<typeof form.evaluate>, addr: string) => showValue(values[addr]);

/** Dimensional rows 12,13,16-19 and spring rates 23,24,26 with each sample on its nominal; Installed Load 100 kgf. */
function passing(): Cells {
  const cells: Cells = { ...form.blank(), B24: 5.2, B25: 100, G33: "PASS" };
  const nominal: Record<number, number> = { 12: 16, 13: 129, 16: 86, 17: 59, 18: 442, 19: 10.65, 23: 4.6, 24: 5.2, 26: 254 };
  for (const [row, value] of Object.entries(nominal)) {
    cells[`E${row}`] = value;
    cells[`F${row}`] = value;
    cells[`G${row}`] = value;
  }
  return cells;
}

describe("FRM-VAL-006 coil spring: the workbook, ported", () => {
  it("is Rev A, uses PASS/FAIL, and is drawn from the workbook layout", () => {
    assert.equal(form.def.revision, "A");
    assert.deepEqual(form.def.words, { pass: "PASS", fail: "FAIL" });
    assert.equal(form.def.layout.merges.length, 40);
  });

  it("averages the samples that are filled in, and is blank with none", () => {
    const values = form.evaluate({ ...form.blank(), E12: 16.02, F12: 15.98 });
    assert.ok(Math.abs((values.H12 as number) - 16) < 1e-9);
    assert.equal(text(form.evaluate(form.blank()), "H12"), "");
  });

  it("RESULT is PASS inside nominal + min/max and FAIL outside it (H >= B+C and H <= B+D)", () => {
    const inside = form.evaluate({ ...form.blank(), E12: 16.04, F12: 16.04, G12: 16.04 });
    assert.equal(text(inside, "I12"), "PASS");
    const outside = form.evaluate({ ...form.blank(), E12: 16.06, F12: 16.06, G12: 16.06 });
    assert.equal(text(outside, "I12"), "FAIL");
    const averaged = form.evaluate({ ...form.blank(), E13: 127.5, F13: 130.5, G13: 129 });
    assert.equal(text(averaged, "I13"), "PASS");
  });

  it("spring rate 1 takes its min and max as 5% of the nominal", () => {
    const values = form.evaluate({ ...form.blank(), E23: 4.8, F23: 4.8, G23: 4.8 });
    assert.ok(Math.abs((values.C23 as number) + 0.23) < 1e-9);
    assert.ok(Math.abs((values.D23 as number) - 0.23) < 1e-9);
    assert.equal(text(values, "I23"), "PASS");
    assert.equal(text(form.evaluate({ ...form.blank(), E23: 4.9 }), "I23"), "FAIL");
  });

  it("max design force is (B25 x 9.81) x 3.25 / 2", () => {
    assert.ok(Math.abs((form.evaluate({ ...form.blank(), B25: 100 }).B30 as number) - (100 * 9.81 * 3.25) / 2) < 1e-9);
  });
});

describe("FRM-VAL-006 coil spring: Wahl stress and the 1200 MPa check", () => {
  /** Wahl max shear stress worked by hand: tau = 8 * D * F * Kw / (pi * d^3), D = OD - d, C = D/d, Kw = (4C-1)/(4C-4) + 0.615/C. */
  function wahl(d: number, od: number, load: number): number {
    const force = (load * 9.81 * 3.25) / 2;
    const mean = od - d;
    const index = mean / d;
    const kw = (4 * index - 1) / (4 * index - 4) + 0.615 / index;
    return (8 * mean * force * kw) / (Math.PI * d ** 3);
  }

  it("matches the hand calculation, using the averaged wire and outside diameter", () => {
    const values = form.evaluate({ ...form.blank(), E12: 16, E13: 129, B25: 100 });
    assert.ok(Math.abs((values.G31 as number) - wahl(16, 129, 100)) < 1e-6);
    const other = form.evaluate({ ...form.blank(), E12: 15.9, F12: 16.1, E13: 128, F13: 130, B25: 120 });
    assert.ok(Math.abs((other.G31 as number) - wahl(16, 129, 120)) < 1e-6);
  });

  it("is blank until the wire diameter and outside diameter are measured", () => {
    assert.equal(text(form.evaluate({ ...form.blank(), B25: 100 }), "G31"), "");
    assert.equal(text(form.evaluate({ ...form.blank(), E12: 16, B25: 100 }), "G31"), "");
  });

  it("is PASS with an X under Pass at or below 1200 MPa, and FAIL with an X under Fail above it", () => {
    const low = form.evaluate({ ...form.blank(), E12: 16, E13: 129, B25: 100 });
    assert.ok((low.G31 as number) <= 1200);
    assert.equal(text(low, "G32"), "PASS");
    assert.equal(text(low, "C32"), "X");
    assert.equal(text(low, "E32"), "");
    // A heavy installed load pushes the stress past 1200 MPa.
    const high = form.evaluate({ ...form.blank(), E12: 16, E13: 129, B25: 1500 });
    assert.ok((high.G31 as number) > 1200);
    assert.equal(text(high, "G32"), "FAIL");
    assert.equal(text(high, "C32"), "");
    assert.equal(text(high, "E32"), "X");
  });
});

describe("FRM-VAL-006 coil spring: pass/fail added", () => {
  it("I14 and I15 return FAIL, not FALSE, when the coil type does not match", () => {
    const wrong = form.evaluate({ ...form.blank(), E14: "Squared", E15: "Ground Flat" });
    assert.equal(text(wrong, "I14"), "FAIL");
    assert.equal(text(wrong, "I15"), "FAIL");
    const right = form.evaluate({ ...form.blank(), E14: "Tangential", F14: "Tangential", G14: "", E15: "Pigtail" });
    assert.equal(text(right, "I14"), "PASS");
    assert.equal(text(right, "I15"), "PASS");
    // A second sample that differs fails the row too.
    assert.equal(text(form.evaluate({ ...form.blank(), E14: "Tangential", F14: "Pigtail" }), "I14"), "FAIL");
    assert.equal(text(form.evaluate({ ...form.blank(), E14: "" }), "I14"), "");
  });

  it("G33 is a PASS/FAIL dropdown, and C33/E33 tick from it", () => {
    assert.equal(form.kinds.G33, "select");
    assert.deepEqual(form.lists.G33, ["PASS", "FAIL"]);
    assert.equal(text(form.evaluate({ ...form.blank(), G33: "PASS" }), "C33"), "X");
    assert.equal(text(form.evaluate({ ...form.blank(), G33: "FAIL" }), "E33"), "X");
    assert.equal(text(form.evaluate(form.blank()), "C33"), "");
  });
});

describe("FRM-VAL-006 coil spring: the approval rollup", () => {
  it("is blank, and ticks neither box, until every counted row has a result", () => {
    const blank = form.evaluate(form.blank());
    assert.equal(text(blank, "A4"), "");
    assert.equal(text(blank, "B35"), "[ ] APPROVED");
    assert.equal(text(blank, "D35"), "[ ] REJECTED");
    const partial = passing();
    delete partial.E19;
    delete partial.F19;
    delete partial.G19;
    assert.equal(text(form.evaluate(partial), "A4"), "");
    const noVisual = passing();
    delete noVisual.G33;
    assert.equal(text(form.evaluate(noVisual), "A4"), "");
    assert.equal(form.status(form.evaluate(partial)), "");
  });

  it("a complete passing sheet is PASS and ticks APPROVED", () => {
    const values = form.evaluate(passing());
    assert.equal(text(values, "A4"), "PASS");
    assert.equal(text(values, "B35"), "[ X ] APPROVED");
    assert.equal(text(values, "D35"), "[ ] REJECTED");
    assert.equal(form.status(values), "Pass");
  });

  it("any failed row, the stress check or the visual check makes it FAIL and ticks REJECTED", () => {
    const dimension = passing();
    dimension.E18 = 460;
    dimension.F18 = 460;
    dimension.G18 = 460;
    const wrongType = { ...passing(), E14: "Squared" };
    const stress = { ...passing(), B25: 1500 };
    const visual = { ...passing(), G33: "FAIL" };
    for (const cells of [dimension, wrongType, stress, visual]) {
      const values = form.evaluate(cells);
      assert.equal(text(values, "A4"), "FAIL");
      assert.equal(text(values, "B35"), "[ ] APPROVED");
      assert.equal(text(values, "D35"), "[ X ] REJECTED");
      assert.equal(form.status(values), "Fail");
    }
  });

  it("a row with a blank nominal is skipped (Spring Rate 2 has no nominal until one is typed)", () => {
    const cells = passing();
    delete cells.B24;
    delete cells.E24;
    delete cells.F24;
    delete cells.G24;
    assert.equal(text(form.evaluate(cells), "A4"), "PASS");
    // With the nominal typed in, the row counts again and is still unanswered.
    assert.equal(text(form.evaluate({ ...cells, B24: 5.2 }), "A4"), "");
  });

  it("APPROVED WITH DEVIATION stays a manual tick, and the sheet has an authorized signature slot", () => {
    assert.equal(form.kinds.F35, "tick");
    assert.equal(form.formulas.F35, undefined);
    assert.equal(form.def.layout.cells.F35?.v, "[ ] APPROVED WITH DEVIATION");
    assert.equal(form.kinds.B36, "signature");
    assert.equal(form.def.signatures?.[0]?.path, "authorizedSignature");
  });

  it("keeps the workbook's dropdowns and starts with the default inspector", () => {
    assert.deepEqual(form.lists.B14, ["Pigtail", "Tangential", "Squared", "Ground Flat"]);
    assert.equal(form.blank().B8, "Shawn Parnell");
    assert.equal(form.blank().E14, "Tangential");
  });
});
