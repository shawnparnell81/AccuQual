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
  assert.equal(FORMULA_TEXT.F14, 'IF(AND(D14>=B14-C14, D14<=B14+C14), "Passed", "Failed")');
  assert.equal(FORMULA_TEXT.B17, "B16/B15");
  assert.equal(FORMULA_TEXT.G46, 'IF(AND(E46>=B46-C46, E46<=B46+C46), "Passed", "Failed")');
});

test("dropdown lists come from the sheet's data validation", () => {
  assert.deepEqual(SUPPLIER_OPTIONS, ["Sensen", "Jinbo", "----"]);
  assert.deepEqual(INSPECTOR_OPTIONS, ["Timothy Therrien", "Glen Fulmore", "Ron Wertz", "Sam Giannetti", "Maxwell Tollefson", "Lee Beeson"]);
  assert.deepEqual(listOptions("Sensen, Jinbo,     ----"), SUPPLIER_OPTIONS);
});

test("a blank report calculates like the sheet", () => {
  const result = evaluate(blankCells());
  assert.equal(result.F12, "Failed");
  assert.equal(result.G12, "Failed");
  assert.equal(result.F13, "Passed");
  assert.equal(result.F18, "Failed");
  assert.equal(result.B17, "#DIV/0!");
  assert.equal(result.B14, 0);
  assert.equal(result.A1, "Failed");
  assert.equal(showValue("B17", result.B17), "#DIV/0!");
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

test("the sheet keeps the workbook labels, including the original spelling", () => {
  const text = buildSheetRows()
    .flat()
    .map((cell) => cell.text)
    .filter(Boolean)
    .join("\n");
  assert.match(text, /CSA VALIDATION REPORT/);
  assert.match(text, /Doc ID: FRM-VAL-001/);
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
