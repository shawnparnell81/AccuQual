import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { displayFormulaValue, evaluateCells, passFailFill } from "./excelFormulas.ts";

describe("excel formulas", () => {
  it("evaluates SUM, AVERAGE, MIN, MAX, and ROUND over cells and ranges", () => {
    const values = evaluateCells({
      A1: "2",
      A2: "4",
      A3: "6",
      B1: "=SUM(A1:A3)",
      B2: "=AVERAGE(A1:A3)",
      B3: "=MIN(A1,A2,A3)",
      B4: "=MAX(A1:A3)",
      B5: "=ROUND(10/3, 2)",
    });
    assert.equal(values.B1, 12);
    assert.equal(values.B2, 4);
    assert.equal(values.B3, 2);
    assert.equal(values.B4, 6);
    assert.equal(values.B5, 3.33);
  });

  it("evaluates IF, comparisons, and cell references used for pass or fail", () => {
    const values = evaluateCells({
      B13: "10",
      C13: "1",
      D13: "10.5",
      F13: '=IF(AND(D13>=B13-C13, D13<=B13+C13), "Passed", "Failed")',
      D14: "20",
      F14: '=IF(D14>=B13, "Passed", "Failed")',
    });
    assert.equal(values.F13, "Passed");
    assert.equal(values.F14, "Passed");
    assert.deepEqual(passFailFill(displayFormulaValue(values.F13)), { background: "#4EA72E", color: "#ffffff" });
    const fail = evaluateCells({ A1: "1", B1: "5", C1: '=IF(B1<=A1, "Pass", "Fail")' });
    assert.equal(fail.C1, "Fail");
    assert.equal(passFailFill("Fail")?.background, "#FF0000");
  });

  it("follows a formula that points at another formula and reports a cycle", () => {
    const values = evaluateCells({
      A1: "=B1+1",
      B1: "=A1+1",
      C1: "=SUM(1, 2, 3)",
    });
    assert.equal(values.A1, "#CYCLE!");
    assert.equal(values.C1, 6);
  });
});
