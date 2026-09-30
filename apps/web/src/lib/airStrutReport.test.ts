import assert from "node:assert/strict";
import test from "node:test";
import {
  FORMULA_TEXT,
  OVERALL_FORMULA,
  PASS_FILL,
  blankCells,
  evaluate,
  overallResult,
  passingExample,
  statusFill,
} from "./airStrutReport";
import { buildAirStrutRows } from "./airStrutSheet";
import { AUDIT_SUMMARY_LEAD, auditScore, auditSignatures, auditSummaryLayout, auditSummaryStarter } from "./auditSummary";

test("air strut formulas match the workbook, including both overall cells", () => {
  assert.equal(FORMULA_TEXT.H13, 'IF(OR(B13="", D13="", F13=""), "Fail", IF(ABS(F13 - B13) <= D13, "Pass", "Fail"))');
  assert.equal(FORMULA_TEXT.B28, "(B9*(D9/100)/2/F9)*4.45");
  assert.equal(FORMULA_TEXT.F29, "(B28-F24)/((F25-F24)/20)+20");
  assert.equal(FORMULA_TEXT.B30, "((B29-20)*((B27-B26)/20))+B26");
  assert.equal(FORMULA_TEXT.D40, 'IF(COUNT(D34, D36, D38) < 3, "Fail", IF(ABS(D36 - D34) <= D38, "Pass", "Fail"))');
  assert.equal(FORMULA_TEXT.H65, 'IF(COUNT(H59, H61, H63) < 3, "Fail", IF(ABS(H61 - H59) <= H63, "Pass", "Fail"))');
  assert.equal(FORMULA_TEXT.H69, 'IF(OR(B69="", E69=""), "Fail", "Pass")');
  assert.equal(FORMULA_TEXT.F82, 'IF(OR(B82="", D82=""), "Fail", "Pass")');
  assert.equal(FORMULA_TEXT.G7, OVERALL_FORMULA);
  assert.equal(FORMULA_TEXT.B84, OVERALL_FORMULA);
});

test("a blank air strut fails open checks and names Shawn Parnell", () => {
  const cells = blankCells();
  assert.equal(cells.B8, "Shawn Parnell");
  const result = evaluate(cells);
  assert.equal(result.H13, "Fail");
  assert.equal(result.D40, "Fail");
  assert.equal(result.H69, "Fail");
  assert.equal(result.F79, "Fail");
  assert.equal(result.B28, "#DIV/0!");
  assert.equal(result.G7, "FAIL");
  assert.equal(result.B84, "FAIL");
  assert.equal(overallResult(cells), "FAIL");
  assert.equal(statusFill("FAIL"), "#FF0000");
  assert.equal(statusFill("PASS"), PASS_FILL);
});

test("ride height, tolerance, and damping follow the sheet", () => {
  const cells = passingExample();
  const result = evaluate(cells);
  assert.equal(result.B28, 4450);
  assert.equal(result.B29, 890);
  assert.equal(result.F29, 890);
  assert.equal(result.H29, "Pass");
  assert.equal(result.B30, 445);
  assert.equal(result.F30, 445);
  assert.equal(result.H30, "Pass");
  assert.equal(result.H13, "Pass");
  assert.equal(result.H17, "#VALUE!");
  assert.equal(result.D40, "Pass");
  assert.equal(result.H41, "Pass");
  assert.equal(result.H72, "Pass");
  assert.equal(result.F79, "Pass");
  assert.equal(result.G7, "PASS");

  cells.F13 = 12;
  assert.equal(evaluate(cells).H13, "Fail");
  assert.equal(evaluate(cells).G7, "FAIL");

  cells.F13 = 10;
  cells.D36 = 200;
  assert.equal(evaluate(cells).D40, "Fail");
  assert.equal(evaluate(cells).G7, "FAIL");
});

test("the air strut sheet keeps the source title and does not print a form number", () => {
  const text = buildAirStrutRows()
    .flat()
    .map((item) => item?.text ?? "")
    .join("\n");
  assert.match(text, /AIR STRUT VALIDATION DOCUMENT/);
  assert.equal(/FRM-VAL-/.test(text), false);
  assert.match(text, /1\.0 PROJECT & VEHICLE INFORMATION/);
  assert.match(text, /4\.0 DAMPING FORCE TEST/);
  assert.match(text, /FINAL DISPOSITION/);
});

test("audit summary score is passed over items audited", () => {
  assert.equal(auditScore({}), "");
  assert.equal(auditScore({ B11: 0, D11: 0 }), "#DIV/0!");
  assert.equal(auditScore({ B11: 8, D11: 6 }), "75%");
  assert.equal(auditSummaryStarter()[AUDIT_SUMMARY_LEAD], "Shawn Parnell");
  const text = auditSummaryLayout()
    .rows.flat()
    .map((cell) => cell.text ?? "")
    .join("\n");
  assert.match(text, /INTERNAL AUDIT SUMMARY REPORT/);
  assert.equal(/FRM-GEN-001/.test(text), false);
  assert.match(text, /OVERALL COMPLIANCE SCORE/);
  assert.match(text, /Lead Auditor Signature/);
  assert.deepEqual(auditSignatures({ cells: {}, leadAuditorSignature: "Shawn Parnell — 2026-09-30" }), {
    leadAuditorSignature: "Shawn Parnell — 2026-09-30",
  });
});
