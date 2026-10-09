import assert from "node:assert/strict";
import test from "node:test";
import { FORMULA_TEXT, blankCells, evaluate, overallResult, passingExample } from "./airSpringReport";
import { buildAirSpringRows } from "./airSpringSheet";
import { kpiScore, monthlyStarter } from "./monthlyEngineeringReport";
import { blankBrakeCells, blankInjectorCells, evaluateBrake, evaluateInjector, overallBrake, overallInjector } from "./partInspection";
import { VISITOR_ROWS, visitorStarter } from "./visitorLog";

test("air spring keeps the source title and the air-spring purpose", () => {
  const text = buildAirSpringRows()
    .flat()
    .map((item) => item?.text ?? "")
    .join("\n");
  assert.match(text, /AIR SPRING VALIDATION DOCUMENT/);
  assert.match(text, /Air Springs/);
  assert.equal(/FRM-VAL-/.test(text), false);
  assert.match(text, /5\.0 ELECTRONICS & HARDWARE/);
  assert.equal(/4\.0 DAMPING/.test(text), false);
  assert.equal(blankCells().B8, "Shawn Parnell");
  assert.equal(FORMULA_TEXT.G7, FORMULA_TEXT.B48);
});

test("air spring ride height matches the strut workbook math", () => {
  const blank = evaluate(blankCells());
  assert.equal(blank.B28, "#DIV/0!");
  assert.equal(blank.H13, "Fail");
  assert.equal(overallResult(blankCells()), "FAIL");

  const filled = evaluate(passingExample());
  assert.equal(filled.B28, 4450);
  assert.equal(filled.B29, 890);
  assert.equal(filled.F29, 890);
  assert.equal(filled.B30, 445);
  assert.equal(filled.F30, 445);
  assert.equal(filled.H16, "#VALUE!");
  assert.equal(filled.G7, "PASS");
  assert.equal(filled.B48, "PASS");
});

test("brake wear sensor passes NA dimensions and fails a blank Y/N", () => {
  const cells = blankBrakeCells();
  cells.B12 = "NA";
  const result = evaluateBrake(cells);
  assert.equal(result.H12, "Pass");
  assert.equal(result.H22, "Fail");
  assert.equal(overallBrake(cells), "Fail");

  cells.B13 = 10;
  cells.D13 = 1;
  cells.G13 = 10.5;
  cells.G22 = "Y";
  cells.G23 = "y";
  cells.G24 = "Y";
  for (const row of [12, 14, 15, 16, 17, 18]) cells[`B${row}`] = "NA";
  assert.equal(evaluateBrake(cells).H13, "Pass");
  assert.equal(overallBrake(cells), "Pass");
});

test("fuel injector trend, 10% packaging, and side-feed deviation", () => {
  const cells = blankInjectorCells();
  for (let row = 12; row <= 17; row += 1) cells[`B${row}`] = "NA";
  for (const row of [21, 22, 23, 24]) cells[`G${row}`] = "Y";
  cells.B29 = 100;
  cells.G29 = 95;
  cells.B30 = 100;
  cells.G30 = 100;
  cells.B31 = 100;
  cells.G31 = 109;
  cells.B38 = 12;
  cells.D38 = 1;
  cells.G38 = 12;
  cells.B41 = 18000;
  cells.B42 = 24000;
  cells.B43 = 15000;
  cells.B44 = 18000;
  cells.B45 = 21000;
  cells.B47 = 100;
  cells.F47 = 100 / 0.7739 / 2;
  cells.B53 = 1;
  cells.G53 = 0;
  const result = evaluateInjector(cells);
  assert.equal(result.D29, 10);
  assert.equal(result.H29, "Pass");
  assert.equal(result.E41, 3);
  assert.equal(result.G41, 3);
  assert.equal(result.H49, "Pass");
  assert.equal(result.H47, "Pass");
  assert.equal(result.H53, "Pass");
  assert.equal(overallInjector(cells), "Pass");

  cells.B41 = 0;
  cells.H34 = true;
  assert.equal(evaluateInjector(cells).H49, "Pass");
});

test("visitor log and monthly engineering report starters", () => {
  assert.equal(VISITOR_ROWS, 14);
  assert.equal(visitorStarter().I2, "Maxwell Tollefson");
  assert.equal(monthlyStarter().prep, "Shawn Parnell");
  assert.deepEqual(kpiScore({ k0f: 4, k0d: 6, k0t: 20 }, 0), { total: "10", percent: "50%" });
  assert.deepEqual(kpiScore({}, 1), { total: "", percent: "" });
  assert.equal(kpiScore({ k2f: 1, k2t: 0 }, 2).percent, "#DIV/0!");
});
