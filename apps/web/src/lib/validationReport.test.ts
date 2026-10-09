import assert from "node:assert/strict";
import test from "node:test";
import {
  FORMULA_TEXT,
  INSPECTOR_OPTIONS,
  PASSED_FILL,
  FAILED_FILL,
  SUPPLIER_OPTIONS,
  blankCells,
  conditionalFill,
  evaluate,
  inPassFailRange,
  listOptions,
  mixedExample,
  overallResult,
  passingExample,
  showValue,
} from "./validationReport";
import { buildSheetRows } from "./validationReportSheet";

test("workbook formulas are all present", () => {
  assert.equal(Object.keys(FORMULA_TEXT).length, 28);
  assert.equal(FORMULA_TEXT.A1, 'IF(COUNTIF(F:G, "Failed") > 0, "Failed", "Passed")');
  assert.equal(FORMULA_TEXT.F12, 'IF(D12=B12, "Passed", "Failed")');
  assert.equal(FORMULA_TEXT.F14, 'IF(AND(D14>=B14-C14, D14<=B14+C14), "Passed", "Failed")');
  assert.equal(FORMULA_TEXT.F18, 'IF(D18<=B18, "Passed", "Failed")');
  assert.equal(FORMULA_TEXT.F41, 'IF(D41<=B41, "Passed", "Failed")');
  assert.equal(FORMULA_TEXT.G45, 'IF(E45<=B45, "Passed", "Failed")');
  assert.equal(FORMULA_TEXT.B17, "B16/B15");
  assert.equal(FORMULA_TEXT.G46, 'IF(AND(E46>=B46-C46, E46<=B46+C46), "Passed", "Failed")');
});

test("dropdown lists come from the sheet's data validation", () => {
  assert.deepEqual(SUPPLIER_OPTIONS, ["Sensen", "Jinbo", "----"]);
  assert.deepEqual(INSPECTOR_OPTIONS, ["Shawn Parnell", "Timothy Therrien", "Glen Fulmore", "Ron Wertz", "Sam Giannetti", "Maxwell Tollefson", "Lee Beeson"]);
  assert.equal(blankCells().B8, "Shawn Parnell");
  assert.deepEqual(listOptions("Sensen, Jinbo,     ----"), SUPPLIER_OPTIONS);
});

test("a blank report leaves unscored rows empty and does not fail them", () => {
  const result = evaluate(blankCells());
  assert.equal(result.F12, "");
  assert.equal(result.G12, "");
  assert.equal(result.F13, "");
  assert.equal(result.F18, "");
  assert.equal(result.B14, "");
  assert.equal(result.D14, "");
  assert.equal(result.F14, "");
  assert.equal(result.B17, "#DIV/0!");
  assert.equal(result.A1, "Passed");
  assert.equal(showValue("B17", result.B17), "#DIV/0!");
  assert.equal(showValue("B14", result.B14), "");
});

test("a filled passing report stays Passed and formats percent stroke", () => {
  const cells = passingExample();
  const result = evaluate(cells);
  assert.equal(result.F12, "Passed");
  assert.equal(result.G13, "Passed");
  assert.equal(result.B14, 180);
  assert.equal(result.D14, 180);
  assert.equal(result.F14, "Passed");
  assert.equal(showValue("B17", result.B17 as number), "50%");
  assert.equal(result.F18, "Passed");
  assert.equal(result.G18, "Passed");
  assert.equal(result.F41, "Passed");
  assert.equal(result.G41, "Passed");
  assert.equal(result.F45, "Passed");
  assert.equal(result.G45, "Passed");
  assert.equal(result.G46, "Passed");
  assert.equal(overallResult(cells), "Passed");
  assert.equal(conditionalFill("A1", "Passed"), PASSED_FILL);
  assert.equal(conditionalFill("F12", "Passed"), PASSED_FILL);
});

test("one failed cell turns the report Failed and paints both colors", () => {
  const cells = mixedExample();
  const result = evaluate(cells);
  assert.equal(result.F12, "Failed");
  assert.equal(result.G12, "Passed");
  assert.equal(result.G18, "Failed");
  assert.equal(result.F18, "Passed");
  assert.equal(result.A1, "Failed");
  assert.equal(conditionalFill("F12", "Failed"), FAILED_FILL);
  assert.equal(conditionalFill("G12", "Passed"), PASSED_FILL);
  assert.equal(conditionalFill("A1", "Failed"), FAILED_FILL);
});

test("conditional formatting follows the workbook ranges and priority", () => {
  assert.equal(inPassFailRange("F6"), true);
  assert.equal(inPassFailRange("G6"), false);
  assert.equal(inPassFailRange("F52"), true);
  assert.equal(inPassFailRange("G52"), false);
  assert.equal(inPassFailRange("F53"), false);
  assert.equal(inPassFailRange("G49"), true);
  assert.equal(conditionalFill("A1", "Failed Passed"), PASSED_FILL);
  assert.equal(conditionalFill("F12", "Failed Passed"), FAILED_FILL);
  assert.equal(conditionalFill("G49", "Conditional Pass"), null);
  assert.equal(conditionalFill("B12", "Passed"), null);
});

const PASS_FAIL = [
  "F12", "G12", "F13", "G13", "F14", "F15", "F16", "F18", "G18", "F22", "F25", "F30", "F36", "F37", "F39", "F40", "F41", "G41", "F45", "G45", "F46", "G46",
];

test("in-tolerance values pass every scored CSA row and the overall result", () => {
  const cells = passingExample();
  const result = evaluate(cells);
  for (const addr of PASS_FAIL) assert.equal(result[addr], "Passed", addr);
  assert.equal(result.A1, "Passed");
  assert.equal(overallResult(cells), "Passed");

  cells.D18 = 26;
  const failed = evaluate(cells);
  assert.equal(failed.F18, "Failed");
  assert.equal(failed.G18, "Passed");
  assert.equal(failed.A1, "Failed");
  assert.equal(overallResult(cells), "Failed");
});

test("live CSA copy: ≤ rows pass inside the max, blank tolerance stays blank, min length does not invent a number", () => {
  const cells = blankCells();
  cells.B18 = 25;
  cells.C18 = "≤";
  cells.D18 = 18;
  cells.E18 = 22;
  cells.B41 = 80;
  cells.C41 = "≤";
  cells.D41 = 60;
  cells.E41 = 70;
  cells.B45 = 25;
  cells.C45 = "≤";
  cells.D45 = 20;
  cells.E45 = 22;
  cells.B25 = 600;
  cells.C25 = "";
  cells.D25 = 598;
  cells.E25 = 603;
  cells.B30 = 450;
  cells.C30 = "";
  cells.D30 = 447;
  cells.E30 = 452;
  cells.E14 = "";
  cells.B15 = 20;
  cells.D15 = 20;
  let result = evaluate(cells);
  assert.equal(result.F18, "Passed");
  assert.equal(result.G18, "Passed");
  assert.equal(result.F41, "Passed");
  assert.equal(result.G41, "Passed");
  assert.equal(result.F45, "Passed");
  assert.equal(result.G45, "Passed");
  assert.equal(result.F25, "");
  assert.equal(result.F30, "");
  assert.equal(result.B14, "");
  assert.equal(result.D14, "");
  assert.equal(result.F14, "");
  assert.equal(result.A1, "Passed");

  cells.D18 = 26;
  result = evaluate(cells);
  assert.equal(result.F18, "Failed");
  assert.equal(result.A1, "Failed");

  cells.C18 = "≥";
  cells.D18 = 25;
  cells.E18 = 30;
  result = evaluate(cells);
  assert.equal(result.F18, "Passed");
  assert.equal(result.G18, "Passed");
  cells.D18 = 24;
  assert.equal(evaluate(cells).F18, "Failed");

  const band = blankCells();
  band.B13 = 300;
  band.C13 = 7;
  band.D13 = 302;
  band.E13 = 308;
  assert.equal(evaluate(band).F13, "Passed");
  assert.equal(evaluate(band).G13, "Failed");
  band.C13 = "";
  assert.equal(evaluate(band).F13, "");
});

test("the sheet keeps the workbook labels, including the original spelling", () => {
  const text = buildSheetRows()
    .flat()
    .map((cell) => cell.text)
    .filter(Boolean)
    .join("\n");
  assert.match(text, /CSA VALIDATION REPORT/);
  assert.match(text, /Doc ID:/);
  assert.equal(/FRM-VAL-/.test(text), false);
  assert.match(text, /Rev: C/);
  assert.match(text, /Effective Date: 03\/26\/2026/);
  assert.match(text, /athe approved DMA engineering drawing/);
  assert.match(text, /Hardwear Grade/);
  assert.match(text, /Tolorences/);
  assert.match(text, /Pass \/ Fail sample 1/);
  assert.match(text, /Pass \/ Fail Sample 2/);
  assert.match(text, /6\.0 FINAL CONCLUSION/);
  assert.match(text, /Engineer who Approved Conditional Pass:/);
});
