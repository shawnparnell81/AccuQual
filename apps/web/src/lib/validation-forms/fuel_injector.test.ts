import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FUEL_INJECTOR_FORM as form } from "./forms/fuel_injector.ts";
import { showValue } from "./engine.ts";
import type { Cells } from "./formModule.ts";
import { readWorkbookSample } from "./workbookSample.ts";

const text = (values: ReturnType<typeof form.evaluate>, addr: string) => showValue(values[addr]);
const near = (value: unknown, expected: number) => assert.ok(typeof value === "number" && Math.abs(value - expected) < 1e-9, `${String(value)} != ${expected}`);

/** Least-squares line through (x, y), written out here so the test does not lean on the engine's own TREND. */
function fit(xs: number[], ys: number[]) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (xs[i]! - mx) ** 2;
    sxy += (xs[i]! - mx) * (ys[i]! - my);
  }
  const slope = sxy / sxx;
  return { slope, at: (x: number) => my + slope * (x - mx) };
}

/** A complete passing Top Feed sheet: dimensions and checks on nominal, perfectly linear flow. */
function passing(): Cells {
  return {
    ...form.blank(),
    G12: 56.1, G14: 11.4, G15: 25.1, G16: 2,
    G21: "Y", G22: "Y", G23: "Y", G24: "Y",
    G29: 40, G30: 30, G31: 80,
    G38: 11,
    B41: 60, B42: 120, B43: 90, B44: 120, B45: 150, // E = 0.01 .. 0.05, a straight line against PW 3..7
    B47: 20, F47: 12.9, // 12.9 * 0.7739 = 9.98, inside 10 +/- 5%
    B53: 1, G53: 0.5,
  };
}

describe("FRM-VAL-008 fuel injector: the workbook, ported", () => {
  it("is Rev B and drawn from the workbook layout", () => {
    assert.equal(form.def.revision, "B");
    assert.equal(form.def.docId, "FRM-VAL-008");
    assert.equal(form.def.layout.maxRow, 66);
    assert.equal(form.def.layout.merges.length, 84);
  });

  it("Min and Max are nominal minus and plus tolerance", () => {
    const values = form.evaluate(form.blank());
    near(values.E12, 55.6);
    near(values.F12, 56.6);
    near(values.E14, 11.1);
    near(values.F15, 25.4);
    assert.equal(values.E16, 2);
  });

  it("dimension rows pass inside Min..Max (inclusive) and fail outside it", () => {
    const pass = form.evaluate({ ...form.blank(), G12: 55.6, G14: 11.7, G15: 24.8, G16: 2 });
    for (const row of [12, 14, 15, 16]) assert.equal(text(pass, `H${row}`), "Pass", `H${row}`);
    const fail = form.evaluate({ ...form.blank(), G12: 55.59, G14: 11.71, G15: 24.79, G16: 3 });
    for (const row of [12, 14, 15, 16]) assert.equal(text(fail, `H${row}`), "Fail", `H${row}`);
  });

  it("the NA rule: a nominal of NA passes whatever the sample", () => {
    const values = form.evaluate({ ...form.blank(), G13: 999 });
    assert.equal(text(values, "H13"), "Pass");
    assert.equal(text(values, "H17"), "Pass");
    assert.equal(text(values, "E13"), "#VALUE!", "NA-NA is an error in the workbook too, which the OR(B13=\"NA\") hides");
  });

  it("the Y/N checks pass only on Y", () => {
    const values = form.evaluate({ ...form.blank(), G21: "Y", G22: "N", G23: "y", G24: "" });
    assert.equal(text(values, "H21"), "Pass");
    assert.equal(text(values, "H22"), "Fail");
    assert.equal(text(values, "H23"), "Pass", "Excel compares text without case");
    assert.equal(text(values, "H24"), "Fail", "blank is not Y");
    assert.deepEqual(form.lists.G23, ["Y", "N"]);
    assert.equal(form.kinds.G23, "select");
  });

  it("packaging tolerance is 10% of nominal and the sample must sit inside it", () => {
    const values = form.evaluate({ ...form.blank(), G29: 44, G30: 33.1, G31: 72 });
    near(values.D29, 4);
    near(values.D30, 3);
    near(values.D31, 8);
    assert.equal(text(values, "H29"), "Pass");
    assert.equal(text(values, "H30"), "Fail");
    assert.equal(text(values, "H31"), "Pass");
  });

  it("coil resistance is nominal 11 +/- 0.5", () => {
    assert.equal(text(form.evaluate({ ...form.blank(), G38: 11.5 }), "H38"), "Pass");
    assert.equal(text(form.evaluate({ ...form.blank(), G38: 11.6 }), "H38"), "Fail");
  });

  it("the volumes convert to ml per second: 1 minute readings / 6000, 30 second readings / 3000", () => {
    const values = form.evaluate({ ...form.blank(), B41: 60, B42: 120, B43: 90, B44: 120, B45: 150 });
    near(values.E41, 0.01);
    near(values.E42, 0.02);
    near(values.E43, 0.03);
    near(values.E44, 0.04);
    near(values.E45, 0.05);
  });

  it("raw static flow: Min/Max are B/2 -/+ B*5%, calculated value is F*0.7739, converted flow is x4", () => {
    const values = form.evaluate({ ...form.blank(), B47: 20, F47: 12.9 });
    near(values.D47, 9);
    near(values.E47, 11);
    near(values.G47, 12.9 * 0.7739);
    near(values.B48, 12.9 * 0.7739 * 4);
    assert.equal(text(values, "H47"), "Pass");
    assert.equal(text(form.evaluate({ ...form.blank(), B47: 20, F47: 14.5 }), "H47"), "Fail");
    assert.equal(text(form.evaluate({ ...form.blank(), B47: 20, F47: 11 }), "H47"), "Fail", "below the minimum");
  });

  it("seat leakage passes between 0 and the entered limit (F53 = B53)", () => {
    const pass = form.evaluate({ ...form.blank(), B53: 2, G53: 2 });
    assert.equal(pass.F53, 2);
    assert.equal(text(pass, "H53"), "Pass");
    assert.equal(text(form.evaluate({ ...form.blank(), B53: 2, G53: 2.1 }), "H53"), "Fail");
  });
});

describe("FRM-VAL-008 fuel injector: TREND, SLOPE and the 5% linear deviation", () => {
  it("a straight line gives zero deviation, slope 0.01 and a dynamic flow rate of 600", () => {
    const values = form.evaluate(passing());
    for (let row = 41; row <= 45; row += 1) near(values[`G${row}`], (row - 40) / 100);
    near(values.B49, 0);
    near(values.B50, 0.01);
    near(values.B51, 600);
    assert.equal(text(values, "H49"), "Pass");
  });

  it("uses a least-squares line of E41:E45 against the PW settings 3..7 (hand-checked regression)", () => {
    const cells = { ...passing(), B43: 100 }; // E43 = 0.03333...
    const values = form.evaluate(cells);
    const ys = [60 / 6000, 120 / 6000, 100 / 3000, 120 / 3000, 150 / 3000];
    const line = fit([3, 4, 5, 6, 7], ys);
    for (let i = 0; i < 5; i += 1) near(values[`G${41 + i}`], line.at(3 + i));
    near(values.B50, line.slope);
    near(values.B51, line.slope * 1000 * 60);
    near(values.B49, Math.abs((ys[0]! - line.at(3)) / ys[0]!));
  });

  it("Top Feed: a deviation over 5% at 3ms fails H49; at or under 5% passes", () => {
    const bad = form.evaluate({ ...passing(), B41: 30 }); // E41 = 0.005, far off the line
    assert.ok((bad.B49 as number) > 0.05);
    assert.equal(text(bad, "H49"), "Fail");
    assert.equal(text(bad, "B56"), "Fail");
    const ok = form.evaluate({ ...passing(), B43: 91 }); // a small bend
    assert.ok((ok.B49 as number) <= 0.05, String(ok.B49));
    assert.equal(text(ok, "H49"), "Pass");
  });

  it("Side Feed/Spider (H34 ticked): H49 is Pass whatever the deviation", () => {
    const values = form.evaluate({ ...passing(), B41: 30, H34: true });
    assert.ok((values.B49 as number) > 0.05);
    assert.equal(text(values, "H49"), "Pass");
    assert.equal(text(values, "B56"), "Pass");
    assert.equal(form.kinds.H34, "check");
    assert.equal(form.kinds.D34, "check");
  });

  it("starts as Top Feed (H34 unticked), as the app always has", () => {
    const blank = form.blank();
    assert.equal(blank.H34, false);
    assert.equal(blank.D34, false);
  });

  it("open question: with the volume cells blank the TREND, slope and deviation come out as errors, not blanks", () => {
    // E41:E45 are 0 (blank/6000), so TREND is 0, the deviation is 0/0 (#DIV/0!), and H49 compares that error with 5%.
    const values = form.evaluate(form.blank());
    assert.equal(values.G41, 0);
    assert.equal(text(values, "B49"), "#DIV/0!");
    assert.equal(text(values, "H49"), "#DIV/0!", "the workbook's H49 shows the error until the volumes are entered");
    assert.equal(values.B50, 0);
  });
});

describe("FRM-VAL-008 fuel injector: rollups", () => {
  it("J2 and B56 are Pass on a complete passing sheet", () => {
    const values = form.evaluate(passing());
    assert.equal(text(values, "J2"), "Pass");
    assert.equal(text(values, "B56"), "Pass");
    assert.equal(form.status(values), "Pass");
  });

  it("any failing row in 2.0 to 5.0 makes both rollups Fail", () => {
    for (const change of [{ G12: 60 }, { G21: "N" }, { G29: 99 }, { G38: 20 }, { F47: 30 }, { G53: 5 }] as Cells[]) {
      const values = form.evaluate({ ...passing(), ...change });
      assert.equal(text(values, "J2"), "Fail", JSON.stringify(change));
      assert.equal(text(values, "B56"), "Fail", JSON.stringify(change));
      assert.equal(form.status(values), "Fail");
    }
  });

  it("a blank sheet shows #DIV/0! in the rollups, as the workbook does (H49's error runs through the AND); the badge stays blank", () => {
    const values = form.evaluate(form.blank());
    assert.equal(text(values, "J2"), "#DIV/0!");
    assert.equal(text(values, "B56"), "#DIV/0!");
    assert.equal(form.status(values), "");
    // Once the 3ms volume is typed in, the error is gone and the unanswered rows read Fail.
    assert.equal(text(form.evaluate({ ...form.blank(), B41: 60, B42: 120, B43: 90, B44: 120, B45: 150 }), "J2"), "Fail");
  });

  it("NA rows do not stop the rollup from passing", () => {
    const cells = passing();
    cells.G13 = "";
    const values = form.evaluate(cells);
    assert.equal(text(values, "H13"), "Pass");
    assert.equal(text(values, "J2"), "Pass");
  });

  it("the fills follow the workbook's conditional formats (Pass green, Fail red, blank yellow)", () => {
    const cells = passing();
    cells.G38 = 20;
    const values = form.evaluate(cells);
    assert.equal(form.conditionalStyle("H12", values, cells)?.bg, "#00B050");
    assert.equal(form.conditionalStyle("H38", values, cells)?.bg, "#FF0000");
    assert.equal(form.conditionalStyle("B6", values, cells)?.bg, "#FFFF00", "an empty required cell is yellow");
    assert.equal(form.conditionalStyle("J2", values, cells)?.bg, "#FF0000");
  });
});

describe("FRM-VAL-008 fuel injector: Further Review, signatures and cells", () => {
  it("the section 7 Pass/Fail (B63) is a manual Pass/Fail dropdown", () => {
    assert.equal(form.kinds.B63, "select");
    assert.deepEqual(form.lists.B63, ["Pass", "Fail"]);
    assert.equal(form.formulas.B63, undefined);
  });

  it("the authorized and further-review signature rows are signature slots with the existing data paths", () => {
    assert.equal(form.kinds.B58, "signature");
    assert.equal(form.kinds.B65, "signature");
    assert.deepEqual(form.def.signatures?.map((slot) => slot.path), ["authorizedSignature", "furtherSignature"]);
  });

  it("the three FINAL DISPOSITION tick rows stay manual checkboxes in sections 6 and 7", () => {
    for (const addr of ["C57", "E57", "H57", "C64", "E64", "H64"]) assert.equal(form.kinds[addr], "check", addr);
  });

  it("the inspector dropdown comes from the workbook and defaults to the app's inspector", () => {
    assert.equal(form.kinds.B8, "select");
    assert.ok(form.lists.B8!.includes("Timothy Therrien"));
    assert.equal(form.blank().B8, "Shawn Parnell");
  });

  it("every cell a person fills in is an input and the results are not", () => {
    for (const addr of ["B6", "B7", "G6", "G7", "G8", "G12", "G21", "G29", "G38", "B39", "B41", "B45", "B47", "F47", "B52", "B53", "G53", "B59"]) {
      assert.ok(["input", "select"].includes(form.kinds[addr]!), `${addr} is ${form.kinds[addr]}`);
    }
    for (const addr of ["H12", "E12", "D29", "G41", "B49", "B50", "B51", "B48", "H49", "J2", "B56"]) assert.equal(form.kinds[addr], "calc", addr);
  });
});

describe("FRM-VAL-008 fuel injector: parity with the workbook's own values", () => {
  it("every formula with a stored result in the workbook gives that result", async () => {
    const sample = await readWorkbookSample("FRM-VAL-008-Fuel-Injector-RevB.xlsx");
    const values = form.evaluate(sample.constants);
    const wrong: string[] = [];
    for (const [addr, expected] of Object.entries(sample.cached)) {
      if (!form.formulas[addr]) continue;
      const got = values[addr];
      const same = typeof expected === "number" && typeof got === "number" ? Math.abs(got - expected) < 1e-9 : (got ?? null) === (expected ?? null) || showValue(got) === showValue(expected);
      if (!same) wrong.push(`${addr}: app ${showValue(got)} excel ${showValue(expected)}`);
    }
    assert.deepEqual(wrong, []);
  });
});
