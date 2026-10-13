import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DIV0, VALUE, evaluateFormula, shiftFormula, showValue, parseAddr, XlError, type Value } from "./engine.ts";

function run(formula: string, cells: Record<string, Value> = {}): Value {
  return evaluateFormula(formula, {
    maxRow: 50,
    cell: (col, row) => {
      let letters = "";
      for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
      return cells[`${letters}${row}`] ?? null;
    },
  });
}

const shown = (formula: string, cells?: Record<string, Value>) => showValue(run(formula, cells));

describe("formula engine: arithmetic and comparison the way Excel does it", () => {
  it("does arithmetic with the usual precedence, unary minus and percent", () => {
    assert.equal(run("1+2*3"), 7);
    assert.equal(run("(1+2)*3"), 9);
    assert.equal(run("2^3^2"), 64);
    assert.equal(run("-2^2"), 4);
    assert.equal(run("50%"), 0.5);
    assert.equal(run('"a"&"b"&1'), "ab1");
  });

  it("a blank cell is 0 in arithmetic and comparisons, and an error passes through", () => {
    assert.equal(run("A1+5"), 5);
    assert.equal(run("A1>=0"), true);
    assert.equal(run("A1=0"), true);
    assert.equal(run('A1=""'), true);
    assert.equal(run("5/A1"), DIV0);
    assert.equal(run('"x"+1'), VALUE);
    assert.equal(run("1+(5/A1)"), DIV0);
  });

  it("text compares without case and is greater than any number", () => {
    assert.equal(run('"Pass"="pass"'), true);
    assert.equal(run('"a">5'), true);
    assert.equal(run('5>"a"'), false);
    assert.equal(run('A1="Y"', { A1: "y" }), true);
  });

  it("IF takes only the branch it needs; a missing else is FALSE; a blank test is FALSE", () => {
    assert.equal(run('IF(1>0,"y",1/0)'), "y");
    assert.equal(run('IF(1>2,"y")'), false);
    assert.equal(run('IF(A1,"y","n")'), "n");
    assert.equal(run('IFERROR(1/0,"bad")'), "bad");
  });
});

describe("formula engine: the functions the forms use", () => {
  it("AND and OR read logicals and skip text and blanks in ranges", () => {
    assert.equal(run("AND(A1>0,B1>0)", { A1: 1, B1: 2 }), true);
    assert.equal(run("OR(A1>5,B1>5)", { A1: 1, B1: 2 }), false);
    assert.equal(run('OR(B12="NA")', { B12: "NA" }), true);
    assert.equal(run("AND(A1:A3)", { A1: true, A2: true, A3: false }), false);
  });

  it("works a range against a value cell by cell (array formula), as in AND(H12:H14=\"Pass\")", () => {
    const rows = { H12: "Pass", H13: "Pass", H14: "Pass" };
    assert.equal(run('AND(H12:H14="Pass")', rows), true);
    assert.equal(run('AND(H12:H14="Pass")', { ...rows, H13: "Fail" }), false);
    assert.equal(run('AND(H12:H14="Pass")', { ...rows, H13: null }), false);
    assert.equal(run('IF(AND(H12:H14="Pass", I1:I2="Pass"),"Pass","Fail")', { ...rows, I1: "Pass", I2: "Pass" }), "Pass");
  });

  it("COUNT, COUNTA and COUNTIF", () => {
    const cells = { A1: 1, A2: "x", A3: null, A4: 3, A5: "Failed", A6: "failed" };
    assert.equal(run("COUNT(A1:A6)", cells), 2);
    assert.equal(run("COUNTA(A1:A6)", cells), 5);
    assert.equal(run('COUNTIF(A1:A6,"Failed")', cells), 2);
    assert.equal(run('COUNTIF(A1:A6,">1")', cells), 1);
    assert.equal(run('COUNTIF(A1:A6,"<>x")', cells), 5);
    assert.equal(run('COUNTIF(A:A,"Failed")', cells), 2);
  });

  it("SUM, MIN, MAX and AVERAGE skip text and blanks; AVERAGE of nothing is #DIV/0!", () => {
    const cells = { A1: 4, A2: "x", A3: null, A4: 8 };
    assert.equal(run("SUM(A1:A4)", cells), 12);
    assert.equal(run("AVERAGE(A1:A4)", cells), 6);
    assert.equal(run("MIN(A1:A4)", cells), 4);
    assert.equal(run("MAX(A1:A4)", cells), 8);
    assert.equal(run("AVERAGE(B1:B3)"), DIV0);
    assert.equal(run("MAX(B1:B3)"), 0);
  });

  it("ABS, ROUND, PI, POWER", () => {
    assert.equal(run("ABS(-3.5)"), 3.5);
    assert.equal(run("ROUND(2.345,2)"), 2.35);
    assert.equal(run("ROUND(-2.5,0)"), -3);
    assert.equal(run("POWER(2,10)"), 1024);
    assert.ok(Math.abs((run("PI()") as number) - Math.PI) < 1e-12);
  });

  it("LET names values for the rest of the formula", () => {
    assert.equal(run("LET(x,3,y,4,x*x+y*y)"), 25);
    assert.equal(run("LET(a,A1,a+1)", { A1: 9 }), 10);
  });

  it("SLOPE and TREND fit a straight line", () => {
    const cells = { A1: 2, A2: 4, A3: 6, B1: 1, B2: 2, B3: 3 };
    assert.equal(run("SLOPE(A1:A3,B1:B3)", cells), 2);
    assert.equal(run("TREND(A1:A3,B1:B3,4)", cells), 8);
    assert.equal(run("SLOPE(A1:A1,B1:B1)", { A1: 1, B1: 1 }), DIV0);
  });

  it("SEARCH, ISERROR, NOT, LEN and TRIM (the conditional-format tests)", () => {
    assert.equal(run('NOT(ISERROR(SEARCH("Pass",A1)))', { A1: "Passed" }), true);
    assert.equal(run('NOT(ISERROR(SEARCH("Fail",A1)))', { A1: "Passed" }), false);
    assert.equal(run("LEN(TRIM(A1))=0", { A1: "   " }), true);
    assert.equal(run("LEN(TRIM(A1))=0", {}), true);
    assert.equal(run("LEN(TRIM(A1))=0", { A1: "x" }), false);
  });

  it("an unknown function is #NAME? and a custom function can be supplied", () => {
    assert.equal((run("NOPE(1)") as XlError).code, "#NAME?");
    const value = evaluateFormula("DOUBLE(4)", { maxRow: 1, cell: () => null, functions: { DOUBLE: (args) => (args[0] as number) * 2 } });
    assert.equal(value, 8);
  });
});

describe("formula engine: moving references", () => {
  it("shifts relative references and keeps $ ones, leaving strings alone", () => {
    assert.equal(shiftFormula('IF(E11>=C11-D11, "E11", 1)', 1, 0), 'IF(E12>=C12-D12, "E11", 1)');
    assert.equal(shiftFormula("$B$3+B3+$B3+B$3", 2, 1), "$B$3+C5+$B5+C$3");
    assert.equal(shiftFormula("COUNTIF(G:H, 1)", 3, 0), "COUNTIF(G:H, 1)");
    assert.equal(shiftFormula("SUM(A1:B2)", 1, 1), "SUM(B2:C3)");
  });

  it("reads addresses", () => {
    assert.deepEqual(parseAddr("AB12"), { col: 28, row: 12 });
  });
});
