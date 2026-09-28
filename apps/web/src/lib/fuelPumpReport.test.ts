import assert from "node:assert/strict";
import test from "node:test";
import {
  ARRAY_FORMULA,
  BLANK_FILL,
  FAIL_FILL,
  FORMULA_TEXT,
  PASS_FILL,
  YN_OPTIONS,
  blankCells,
  conditionalFill,
  evaluate,
  inBlankRange,
  inPassFailRange,
  mixedExample,
  overallResult,
  passingExample,
  FLOW_NOTE,
  PACK_NOTE,
  REVIEW_NOTE,
  showValue,
} from "./fuelPumpReport";
import { buildFuelPumpRows } from "./fuelPumpSheet";

test("every expanded formula cell is present, including both array formulas", () => {
  assert.equal(Object.keys(FORMULA_TEXT).length, 69);
  assert.equal(FORMULA_TEXT.J2, ARRAY_FORMULA);
  assert.equal(FORMULA_TEXT.B51, ARRAY_FORMULA);
  assert.equal(FORMULA_TEXT.H13, 'IF(OR(B13="NA"),"Pass",IF(AND(E13<=G13,G13<=F13),"Pass","Fail"))');
  assert.equal(FORMULA_TEXT.E30, 'IF(C30 = "Y", (B30-B30*0.15), B30-B30*0.15)');
  assert.equal(FORMULA_TEXT.F31, 'IF(C31="Y",99999,(B31+D31)*1.15)');
  assert.equal(FORMULA_TEXT.D48, "B48*0.1");
});

test("an empty sheet matches the workbook cache", () => {
  const result = evaluate(blankCells());
  for (let row = 13; row <= 24; row += 1) {
    assert.equal(result[`E${row}`], 0);
    assert.equal(result[`F${row}`], 0);
    assert.equal(result[`H${row}`], "Pass");
  }
  assert.equal(result.D30, "0");
  assert.equal(result.E30, 0);
  assert.equal(result.F30, 0);
  assert.equal(result.H30, "Pass");
  assert.equal(result.D31, "0");
  assert.equal(result.F31, 0);
  assert.equal(result.H31, "Pass");
  assert.equal(result.H34, "Pass");
  assert.equal(result.H38, "Fail");
  assert.equal(result.H41, "Fail");
  assert.equal(result.D46, 0);
  assert.equal(result.H48, "Pass");
  assert.equal(result.J2, "Fail");
  assert.equal(result.B51, "Fail");
  assert.equal(overallResult(blankCells()), "Fail");
});

test("flow minimum and shutoff branches follow the sheet", () => {
  const cells = blankCells();
  cells.B30 = 100;
  cells.C30 = "Y";
  cells.G30 = 90;
  let result = evaluate(cells);
  assert.equal(result.D30, "NA");
  assert.ok(Math.abs(Number(result.E30) - 85) < 1e-6);
  assert.equal(result.F30, 99999);
  assert.equal(result.H30, "Pass");

  cells.C30 = "N";
  result = evaluate(cells);
  assert.equal(result.D30, "0");
  assert.ok(Math.abs(Number(result.E30) - 85) < 1e-6);
  assert.equal(result.F30, 100);
  assert.equal(result.H30, "Pass");

  cells.G30 = 80;
  assert.equal(evaluate(cells).H30, "Fail");

  cells.B31 = 200;
  cells.C31 = "Y";
  cells.G31 = 500;
  result = evaluate(cells);
  assert.equal(result.D31, "NA");
  assert.equal(result.E31, 200);
  assert.equal(result.F31, 99999);
  assert.equal(result.H31, "Pass");

  cells.C31 = "N";
  cells.G31 = 220;
  result = evaluate(cells);
  assert.equal(result.D31, "0");
  assert.equal(result.E31, 200);
  assert.ok(Math.abs(Number(result.F31) - 230) < 1e-6);
  assert.equal(result.H31, "Pass");
});

test("NA nominal passes and a text nominal is an error", () => {
  const cells = blankCells();
  cells.B13 = "NA";
  cells.D13 = 1;
  cells.G13 = 5;
  let result = evaluate(cells);
  assert.equal(result.H13, "Pass");
  assert.equal(result.E13, "#VALUE!");

  cells.B13 = "abc";
  result = evaluate(cells);
  assert.equal(result.E13, "#VALUE!");
  assert.equal(result.H13, "#VALUE!");
  assert.equal(result.J2, "#VALUE!");
});

test("hardware match is case-insensitive and visuals accept only Y", () => {
  const cells = blankCells();
  cells.B34 = "y";
  cells.G34 = "Y";
  cells.G38 = "Y";
  cells.G39 = "n";
  const result = evaluate(cells);
  assert.equal(result.H34, "Pass");
  assert.equal(result.H38, "Pass");
  assert.equal(result.H39, "Fail");
});

test("packaging tolerance is 10 percent of nominal", () => {
  const cells = blankCells();
  cells.B46 = 100;
  cells.G46 = 109;
  const result = evaluate(cells);
  assert.equal(result.D46, 10);
  assert.equal(result.E46, 90);
  assert.equal(result.F46, 110);
  assert.equal(result.H46, "Pass");
  cells.G46 = 111;
  assert.equal(evaluate(cells).H46, "Fail");
});

test("the array formula passes only when every watched result is Pass", () => {
  assert.equal(overallResult(passingExample()), "Pass");
  assert.equal(evaluate(passingExample()).B51, "Pass");
  const mixed = evaluate(mixedExample());
  assert.equal(mixed.H13, "Fail");
  assert.equal(mixed.H38, "Fail");
  assert.equal(mixed.H14, "Pass");
  assert.equal(mixed.J2, "Fail");
  assert.equal(showValue(mixed.E30), "85");
});

test("blank yellow wins over pass and fail, and Fail wins over Pass", () => {
  assert.equal(conditionalFill("B6", ""), BLANK_FILL);
  assert.equal(conditionalFill("G13", "  "), BLANK_FILL);
  assert.equal(conditionalFill("H6", ""), BLANK_FILL);
  assert.equal(conditionalFill("H53", ""), BLANK_FILL);
  assert.equal(conditionalFill("H13", "Fail"), FAIL_FILL);
  assert.equal(conditionalFill("H13", "Pass"), PASS_FILL);
  assert.equal(conditionalFill("B51", "Pass/Fail"), FAIL_FILL);
  assert.equal(conditionalFill("J2", "Pass"), PASS_FILL);
  assert.equal(conditionalFill("J2", "fail"), FAIL_FILL);
  assert.equal(conditionalFill("B58", "pass"), PASS_FILL);
  assert.equal(conditionalFill("A51", "Pass/Fail"), null);
  assert.equal(conditionalFill("J1", "Sample Pass/Fail"), null);
  assert.equal(inBlankRange("D32"), true);
  assert.equal(inBlankRange("C32"), false);
  assert.equal(inPassFailRange("H59"), true);
  assert.equal(inPassFailRange("A51"), false);
  assert.deepEqual([...YN_OPTIONS], ["Y", "N"]);
});

test("the sheet keeps the workbook wording and the blocked minimum cells", () => {
  const rows = buildFuelPumpRows();
  assert.equal(rows.length, 61);
  assert.equal(rows[0]![0]!.text, "FUEL PUMP VALIDATION DOCUMENT");
  assert.equal(rows[26]![0]!.text, FLOW_NOTE);
  assert.match(FLOW_NOTE, /tolerence/);
  assert.match(FLOW_NOTE, /differnce/);
  assert.equal(rows[43]![0]!.text, PACK_NOTE);
  assert.match(PACK_NOTE, /Tolerence/);
  assert.equal(rows[55]![0]!.text, "7.0 Furthur Review");
  assert.equal(rows[56]![0]!.text, REVIEW_NOTE);
  assert.match(REVIEW_NOTE, /intital/);
  assert.equal(rows[29]![0]!.text, "Min flow rate (at test presure) [lph]");
  assert.equal(rows[31]![2]!.kind, "blocked");
  assert.equal(rows[32]![2]!.kind, "blocked");
  assert.equal(rows[33]![2]!.kind, "blocked");
  assert.equal(rows[33]![6]!.kind, "select");
  assert.ok(rows[1]!.some((spec) => spec.addr === "J2" && spec.span === 2));
});
