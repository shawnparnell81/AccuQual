import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AIR_STRUT_FORM as form } from "./forms/air_strut.ts";
import { showValue } from "./engine.ts";
import type { Cells } from "./formModule.ts";
import { readWorkbookSample, sameValue } from "./workbookSample.ts";

const text = (values: ReturnType<typeof form.evaluate>, addr: string) => showValue(values[addr]);
const run = (cells: Cells) => form.evaluate({ ...form.blank(), ...cells });

/** One damping state: Nominal compression/rebound rows, then Sample compression/rebound rows (the tolerances are the form's own). */
function damping(first: number, nominal: number, sample: number): Cells {
  const cells: Cells = {};
  for (const col of ["D", "E", "F", "G", "H"]) {
    cells[`${col}${first}`] = nominal;
    cells[`${col}${first + 1}`] = nominal;
    cells[`${col}${first + 2}`] = sample;
    cells[`${col}${first + 3}`] = sample;
  }
  return cells;
}

/** A complete sheet that passes: state 1 and 2 filled and inside their tolerances, states 3 and 4 not used. */
function passing(): Cells {
  return {
    F13: 441, F14: 123, F16: "1 stud", F17: "EYELET", F20: 40,
    B9: 3000, D9: 50, F9: 1,
    B24: 100, B25: 200, B26: 5, B27: 10,
    F24: 101, F25: 201, F26: 5.1, F27: 10.1,
    D29: 1, D30: 1,
    ...damping(34, 1000, 1001),
    ...damping(42, 2000, 2001),
    E73: "m10 NYLOCK", B73: "M10 nylock",
    B79: 1, D79: 1, B80: 2, D80: 2, B81: 3, D81: 3, B82: 4, D82: 4,
  };
}

describe("FRM-VAL-010 air strut: the workbook, ported", () => {
  it("is Rev A, FRM-VAL-010, and drawn from the workbook layout", () => {
    assert.equal(form.def.revision, "A");
    assert.equal(form.def.docId, "FRM-VAL-010");
    assert.equal(form.def.layout.merges.length, 138);
    assert.deepEqual(form.def.resultCells, ["G7", "B84"]);
  });

  it("every formula the form did not change gives what Excel stored, on the workbook's own values", async () => {
    const sample = await readWorkbookSample("FRM-VAL-010-Air-Strut-RevA.xlsx");
    const values = form.evaluate(sample.constants);
    const changed = new Set(Object.keys(form.def.formulas ?? {}));
    for (const [at, expected] of Object.entries(sample.cached)) {
      if (changed.has(at) || !form.formulas[at]) continue;
      assert.ok(sameValue(values[at], expected), `${at}: app ${text(values, at)} vs Excel ${showValue(expected)}`);
    }
  });

  it("H13, H14 and H20: ABS(F-B)<=D, blank is Fail", () => {
    const values = run({ F13: 443, F14: 127, F20: 130 });
    assert.equal(text(values, "H13"), "Pass");
    assert.equal(text(values, "H14"), "Fail");
    assert.equal(text(values, "H20"), "Pass", "40 with tolerance 100 passes anything up to 140");
    const blank = run({});
    for (const row of [13, 14, 20]) assert.equal(text(blank, `H${row}`), "Fail", `H${row}`);
  });

  it("ride height: B28, B29, B30, F29, F30 and their rows", () => {
    const values = run({ B9: 3000, D9: 50, F9: 1, B24: 100, B25: 200, B26: 5, B27: 10, F24: 101, F25: 201, F26: 5.1, F27: 10.1, D29: 1, D30: 1 });
    assert.ok(Math.abs((values.B28 as number) - 3337.5) < 1e-9);
    assert.ok(Math.abs((values.B29 as number) - 667.5) < 1e-9);
    assert.ok(Math.abs((values.F29 as number) - 667.3) < 1e-9);
    assert.ok(Math.abs((values.B30 as number) - 166.875) < 1e-9);
    assert.ok(Math.abs((values.F30 as number) - 166.925) < 1e-9);
    assert.equal(text(values, "H29"), "Pass");
    assert.equal(text(values, "H30"), "Pass");
    assert.equal(text(run({ ...passing(), F25: 260 }), "H29"), "Fail");
  });

  it("rows 29 and 30 fail until a tolerance is typed in D (kept as written)", () => {
    const values = run({ ...passing(), D29: "", D30: "" });
    assert.equal(text(values, "H29"), "Fail");
    assert.equal(text(values, "H30"), "Fail");
  });

  it("a blank form shows the workbook's errors where it divides by nothing", () => {
    assert.equal(text(run({}), "B28"), "#DIV/0!");
  });

  it("rows 24-27 have no result cell, as in the workbook", () => {
    for (const row of [24, 25, 26, 27]) assert.equal(form.kinds[`H${row}`], "blocked");
  });

  it("weights F79:F82 only check that a value was entered", () => {
    const values = run({ B79: 1, D79: 5, B80: 2 });
    assert.equal(text(values, "F79"), "Pass");
    assert.equal(text(values, "F80"), "Fail");
    assert.equal(text(values, "F81"), "Fail");
  });
});

describe("FRM-VAL-010 air strut: the NA rows", () => {
  it("rows 15, 18 and 19 (nominal and tolerance NA) show Pass, even with the sample blank", () => {
    const values = run({});
    for (const row of [15, 18, 19]) assert.equal(text(values, `H${row}`), "Pass", `H${row}`);
    assert.equal(text(run({ F15: "anything" }), "H15"), "Pass");
  });

  it("rows 70, 71, 72, 74 and 75 (nominal NA) show Pass", () => {
    const values = run({});
    for (const row of [70, 71, 72, 74, 75]) assert.equal(text(values, `H${row}`), "Pass", `H${row}`);
  });
});

describe("FRM-VAL-010 air strut: the text-match rows", () => {
  it("rows 16 and 17 pass when F matches B, trimmed, in any case", () => {
    const values = run({ F16: "  1 stud ", F17: "Eyelet" });
    assert.equal(text(values, "H16"), "Pass");
    assert.equal(text(values, "H17"), "Pass");
    assert.equal(form.kinds.F16, "input");
    assert.equal(form.kinds.F17, "input");
  });

  it("a different or blank mounting type is Fail, and nothing errors", () => {
    const values = run({ F16: "2 STUD" });
    assert.equal(text(values, "H16"), "Fail");
    assert.equal(text(values, "H17"), "Fail");
    assert.ok(!text(values, "H16").startsWith("#"));
  });

  it("row 73 (a typed nominal) passes when E matches B, and fails when blank or different", () => {
    assert.equal(text(run({ B73: "M10 Nylock", E73: "m10 nylock" }), "H73"), "Pass");
    assert.equal(text(run({ B73: "M10 Nylock", E73: "M12" }), "H73"), "Fail");
    assert.equal(text(run({ B73: "M10 Nylock" }), "H73"), "Fail");
    assert.equal(text(run({}), "H73"), "Fail");
  });
});

describe("FRM-VAL-010 air strut: damping states", () => {
  it("states 1 and 2, when their Nominal rows are filled, are graded (blank = Fail until complete)", () => {
    const values = run({ ...damping(34, 1000, 1001) });
    for (const col of ["D", "E", "F", "G", "H"]) {
      assert.equal(text(values, `${col}40`), "Pass");
      assert.equal(text(values, `${col}41`), "Pass");
    }
    // State 2 has no Nominal at all, so it is not graded; a nominal with a missing sample fails.
    assert.equal(text(values, "D48"), "");
    assert.equal(text(run({ D42: 1000 }), "D48"), "Fail");
  });

  it("a sample outside the tolerance fails", () => {
    const values = run({ ...damping(34, 1000, 9000) });
    assert.equal(text(values, "D40"), "Fail", "50 over the 175 tolerance is 500 off");
    assert.equal(text(values, "G41"), "Fail");
  });

  it("states 3 and 4 with a blank Nominal block have blank Pass/Fail cells", () => {
    const values = run({});
    for (const row of [56, 57, 64, 65]) for (const col of ["D", "E", "F", "G", "H"]) assert.equal(text(values, `${col}${row}`), "", `${col}${row}`);
  });

  it("state 3 or 4 counts again as soon as a Nominal value is typed", () => {
    const values = run({ D50: 500 });
    assert.equal(text(values, "D56"), "Fail");
    assert.equal(text(values, "E56"), "Fail", "the nominal block is in use, so the empty columns are Fail");
    // States 3 and 4 carry no tolerances in the workbook, so they are typed in (kept as written).
    const tolerances: Cells = {};
    for (const col of ["D", "E", "F", "G", "H"]) for (const row of [54, 55]) tolerances[`${col}${row}`] = 20;
    const graded = run({ ...damping(50, 800, 801), ...tolerances });
    assert.equal(text(graded, "D56"), "Pass");
    assert.equal(text(graded, "G57"), "Pass");
  });

  it("the Amps text of each state is an editable field with the workbook's text as its starting value", () => {
    for (const addr of ["B34", "B42", "B50", "B58"]) assert.equal(form.kinds[addr], "input");
    const blank = form.blank();
    assert.match(String(blank.B34), /State 1/);
    assert.match(String(blank.B58), /State 4/);
  });

  it("unused states do not hold up the rollup (G7 and B84)", () => {
    const values = run(passing());
    assert.equal(text(values, "G7"), "PASS");
    assert.equal(text(values, "D56"), "");
    assert.equal(text(values, "D64"), "");
  });
});

describe("FRM-VAL-010 air strut: electronics and hardware (rows 69-75)", () => {
  it("row 69 has no tolerance: no result, a hint, and it never fails the rollup", () => {
    const blank = form.blank();
    assert.equal(form.formulas.H69, undefined);
    assert.equal(form.kinds.H69, "label");
    assert.equal(form.def.layout.cells.H69?.v, "No tolerance on form");
    const values = run({ ...passing(), E69: 9999 });
    assert.equal(text(values, "G7"), "PASS");
  });

  it("there is no result formula on H69 and none that contradicts the rules on H70-H75", () => {
    assert.equal(form.formulas.H69, undefined);
    for (const row of [70, 71, 72, 74, 75]) assert.equal(form.formulas[`H${row}`], `IF(B${row}="NA","Pass","")`);
  });
});

describe("FRM-VAL-010 air strut: the rollup", () => {
  it("a complete passing sheet is PASS in G7 and B84, which are one rollup", () => {
    const values = run(passing());
    assert.equal(text(values, "G7"), "PASS");
    assert.equal(text(values, "B84"), "PASS");
    assert.equal(form.formulas.B84, "G7");
    assert.equal(form.status(values), "Pass");
  });

  it("one failing row, anywhere, makes both FAIL", () => {
    for (const change of [{ F13: 500 }, { F16: "2 STUD" }, { D79: "" }, { E73: "M12" }, { D36: 9999 }] as Cells[]) {
      const values = run({ ...passing(), ...change });
      assert.equal(text(values, "G7"), "FAIL", JSON.stringify(change));
      assert.equal(text(values, "B84"), "FAIL");
      assert.equal(form.status(values), "Fail");
    }
  });

  it("blank = Fail is kept: an empty form is FAIL", () => {
    const values = run({});
    assert.equal(text(values, "G7"), "FAIL");
    assert.equal(text(values, "B84"), "FAIL");
    assert.equal(form.status(values), "Fail");
  });

  it("the header and final result take the workbook's PASS / FAIL fills", () => {
    const cells = { ...form.blank(), ...passing() };
    const values = form.evaluate(cells);
    assert.equal(form.conditionalStyle("G7", values, cells)?.bg, "#0EBB5F");
    const failing = { ...cells, F13: 500 };
    assert.equal(form.conditionalStyle("G7", form.evaluate(failing), failing)?.bg, "#FF0000");
  });
});

describe("FRM-VAL-010 air strut: editable cells, tick and signature", () => {
  it("the inspector starts as the app's default, and APPROVED WITH DEVIATION is a manual tick", () => {
    assert.equal(form.blank().B8, "Shawn Parnell");
    assert.equal(form.kinds.F84, "tick");
    assert.equal(form.formulas.F84, undefined);
  });

  it("the authorized signature sits on B85 under the existing 'authorizedSignature' path", () => {
    assert.deepEqual(form.def.signatures?.map((slot) => [slot.addr, slot.path]), [["B85", "authorizedSignature"]]);
    assert.equal(form.kinds.B85, "signature");
  });

  it("the table corner cells and the trailing blank rows are not places to type", () => {
    for (const addr of ["A33", "A68", "A87", "A88"]) assert.equal(form.kinds[addr], "blocked", addr);
  });
});
