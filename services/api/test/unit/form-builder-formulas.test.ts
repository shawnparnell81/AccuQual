import { describe, expect, it } from "vitest";
import {
  ERR_CIRC,
  ERR_DIV0,
  ERR_NAME,
  ERR_NUM,
  ERR_REF,
  ERR_VALUE,
  MAX_FORMULA_LENGTH,
  MAX_NESTING,
  displayValue,
  evaluateGrid,
  formulaProblem,
  rewriteFormula,
} from "../../src/modules/form-builder/formulaEngine.js";
import { recomputeGridAnswers } from "../../src/modules/form-builder/gridFill.js";
import { gridStructureError } from "../../src/modules/form-builder/gridStructure.js";

const calc = (formula: string, cells: Record<string, string> = {}, size?: { rows: number; cols: number }) =>
  evaluateGrid({ ...cells, Z99: `=${formula}` }, size)["Z99"];

describe("formula engine: values and operators", () => {
  it("reads numbers, text and logicals", () => {
    expect(calc("12.5")).toBe(12.5);
    expect(calc('"Pass"')).toBe("Pass");
    expect(calc('"say ""hi"""')).toBe('say "hi"');
    expect(calc("TRUE")).toBe(true);
    expect(calc("false")).toBe(false);
    expect(calc("1.5e3")).toBe(1500);
    expect(calc("50%")).toBe(0.5);
  });

  it("follows Excel precedence", () => {
    expect(calc("1+2*3")).toBe(7);
    expect(calc("(1+2)*3")).toBe(9);
    expect(calc("2^3^2")).toBe(64);
    expect(calc("-2^2")).toBe(4);
    expect(calc("10-4-3")).toBe(3);
    expect(calc("8/4/2")).toBe(1);
    expect(calc('1+2&"x"')).toBe("3x");
    expect(calc("1+2=3")).toBe(true);
    expect(calc("--3")).toBe(3);
  });

  it("joins text and compares", () => {
    expect(calc('"a"&"b"&1')).toBe("ab1");
    expect(calc("3<>4")).toBe(true);
    expect(calc("3<=3")).toBe(true);
    expect(calc("3>=4")).toBe(false);
    expect(calc('"abc"="ABC"')).toBe(true);
    expect(calc('"b">"a"')).toBe(true);
    expect(calc('1<"a"')).toBe(true);
  });

  it("uses references, absolute references and ranges", () => {
    const cells = { A1: "2", A2: "3", B1: "4", B2: "=A1*B1" };
    expect(calc("A1+A2", cells)).toBe(5);
    expect(calc("$A$1+$A2+A$2", cells)).toBe(8);
    expect(calc("SUM(A1:B2)", cells)).toBe(17);
    expect(calc("sum(B2:A1)", cells)).toBe(17);
    expect(calc("A1:A1", cells)).toBe(2);
    expect(calc("A1:A2", cells)).toBe(ERR_VALUE);
  });
});

describe("formula engine: functions", () => {
  const cells = { A1: "10", A2: "20", A3: "", A4: "text", A5: "30", B1: "-4.5" };
  it("SUM, AVERAGE, MIN, MAX and COUNT skip blank and text cells in a range", () => {
    expect(calc("SUM(A1:A5)", cells)).toBe(60);
    expect(calc("AVERAGE(A1:A5)", cells)).toBe(20);
    expect(calc("MIN(A1:A5)", cells)).toBe(10);
    expect(calc("MAX(A1:A5, 99)", cells)).toBe(99);
    expect(calc("COUNT(A1:A5)", cells)).toBe(3);
    expect(calc("COUNT(1, \"x\", A1)", cells)).toBe(2);
  });
  it("empty ranges behave as in Excel", () => {
    expect(calc("SUM(C1:C3)")).toBe(0);
    expect(calc("AVERAGE(C1:C3)")).toBe(ERR_DIV0);
    expect(calc("MIN(C1:C3)")).toBe(0);
    expect(calc("MAX(C1:C3)")).toBe(0);
    expect(calc("COUNT(C1:C3)")).toBe(0);
  });
  it("blank cells count as zero in math", () => {
    expect(calc("A3+1", cells)).toBe(1);
    expect(calc("C9*5")).toBe(0);
  });
  it("IF, AND, OR, NOT", () => {
    expect(calc('IF(A1>5,"Pass","Fail")', cells)).toBe("Pass");
    expect(calc('IF(A1>50,"Pass","Fail")', cells)).toBe("Fail");
    expect(calc("IF(A1>50,1)", cells)).toBe(false);
    expect(calc("IF(FALSE,1/0,2)")).toBe(2);
    expect(calc("AND(A1>5,A2>5)", cells)).toBe(true);
    expect(calc("AND(A1>5,A2>50)", cells)).toBe(false);
    expect(calc("OR(A1>50,A2>5)", cells)).toBe(true);
    expect(calc("or(FALSE,FALSE)")).toBe(false);
    expect(calc("NOT(TRUE)")).toBe(false);
  });
  it("ROUND rounds half away from zero, and ABS", () => {
    expect(calc("ROUND(2.345,2)")).toBe(2.35);
    expect(calc("ROUND(1.005,2)")).toBe(1.01);
    expect(calc("ROUND(-2.5)")).toBe(-3);
    expect(calc("ROUND(1234,-2)")).toBe(1200);
    expect(calc("ABS(B1)", cells)).toBe(4.5);
    expect(calc("Abs(-3)")).toBe(3);
  });
});

describe("formula engine: errors stay in the cell", () => {
  it("#DIV/0!", () => {
    expect(calc("1/0")).toBe(ERR_DIV0);
    expect(calc("1/A1", { A1: "" })).toBe(ERR_DIV0);
  });
  it("#VALUE! for text in math and for formulas that cannot be read", () => {
    expect(calc("A1+1", { A1: "abc" })).toBe(ERR_VALUE);
    expect(calc('"x"*2')).toBe(ERR_VALUE);
    expect(calc("SUM(1,\"x\")")).toBe(ERR_VALUE);
    expect(calc("1+")).toBe(ERR_VALUE);
    expect(calc("(1+2")).toBe(ERR_VALUE);
    expect(calc("IF(1)")).toBe(ERR_VALUE);
  });
  it("#NAME? for unknown functions and names", () => {
    expect(calc("VLOOKUP(1,A1:B2,2)")).toBe(ERR_NAME);
    expect(calc("hello")).toBe(ERR_NAME);
  });
  it("#REF! for references outside the sheet and #REF! typed in", () => {
    expect(calc("A1", {}, { rows: 100, cols: 30 })).toBe(null);
    expect(evaluateGrid({ A1: "=B50" }, { rows: 10, cols: 5 })["A1"]).toBe(ERR_REF);
    expect(evaluateGrid({ A1: "=SUM(A2:F2)" }, { rows: 10, cols: 5 })["A1"]).toBe(ERR_REF);
    expect(calc("#REF!+1")).toBe(ERR_REF);
  });
  it("#CIRC! for circular references, including the cells in the loop", () => {
    const out = evaluateGrid({ A1: "=B1+1", B1: "=C1+1", C1: "=A1+1", D1: "=A1*2", E1: "=E1" });
    expect(out["A1"]).toBe(ERR_CIRC);
    expect(out["B1"]).toBe(ERR_CIRC);
    expect(out["C1"]).toBe(ERR_CIRC);
    expect(out["D1"]).toBe(ERR_CIRC);
    expect(out["E1"]).toBe(ERR_CIRC);
    expect(evaluateGrid({ A1: "=SUM(A1:A3)" })["A1"]).toBe(ERR_CIRC);
  });
  it("errors pass through math, and IF does not hide them", () => {
    expect(calc("(1/0)+1")).toBe(ERR_DIV0);
    expect(calc('IF(1/0>1,"a","b")')).toBe(ERR_DIV0);
    expect(calc("SUM(A1:A2)", { A1: "=1/0", A2: "1" })).toBe(ERR_DIV0);
  });
  it("#NUM! for numbers that overflow", () => {
    expect(calc("10^400")).toBe(ERR_NUM);
  });
});

describe("formula engine: limits", () => {
  it("refuses formulas that are too long or nested too deep", () => {
    expect(formulaProblem("1+".repeat(MAX_FORMULA_LENGTH) + "1")).toMatch(/longer than 2000/);
    expect(formulaProblem("(".repeat(MAX_NESTING + 1) + "1" + ")".repeat(MAX_NESTING + 1))).toMatch(/nested/);
    expect(formulaProblem("(".repeat(MAX_NESTING - 1) + "1" + ")".repeat(MAX_NESTING - 1))).toBeNull();
    expect(calc("(".repeat(500) + "1" + ")".repeat(500))).toBe(ERR_VALUE);
  });
  it("refuses ranges over 30,000 cells", () => {
    expect(formulaProblem("SUM(A1:Z2000)")).toMatch(/more than 30,000 cells/);
    expect(calc("SUM(A1:Z2000)")).toBe(ERR_REF);
    expect(formulaProblem("SUM(A1:AD1000)")).toBeNull();
  });
  it("stops at the step limit with #NUM! instead of hanging", () => {
    const cells: Record<string, string> = {};
    for (let i = 1; i <= 60; i += 1) cells[`B${i}`] = "=SUM(A1:AD1000)";
    const out = evaluateGrid(cells);
    expect(Object.values(out)).toContain(ERR_NUM);
  });
  it("a long chain of references does not crash", () => {
    const cells: Record<string, string> = { A30000: "1" };
    for (let i = 1; i < 30000; i += 1) cells[`A${i}`] = `=A${i + 1}+1`;
    const out = evaluateGrid(cells);
    expect(typeof out["A1"] === "number" || out["A1"] === ERR_NUM).toBe(true);
  });
});

describe("formula engine: nothing is run as code", () => {
  it.each(["constructor", "__proto__", "process", "prototype", "toString", "globalThis", "require"])("%s is a plain unknown name", (name) => {
    expect(calc(name)).toBe(ERR_NAME);
    expect(calc(`${name}()`)).toBe(ERR_NAME);
    expect(calc(`"${name}"`)).toBe(name);
  });
  it("code-like text is refused or stays text", () => {
    expect(calc("process.exit(1)")).toBe(ERR_NAME);
    expect(calc("constructor.constructor(\"return process\")()")).toBe(ERR_VALUE);
    expect(calc("A1", { A1: "__proto__" })).toBe("__proto__");
    expect(evaluateGrid({ __proto__: "=1", A1: "=1+1" } as Record<string, string>)["A1"]).toBe(2);
    expect(calc("`1`")).toBe(ERR_VALUE);
    expect(calc("[1]")).toBe(ERR_VALUE);
  });
});

describe("formula engine: problems named before saving", () => {
  it("names the reason", () => {
    expect(formulaProblem("SUM(A1:A3)")).toBeNull();
    expect(formulaProblem("=IF(A1>1,\"Pass\",\"Fail\")")).toBeNull();
    expect(formulaProblem("VLOOKUP(A1,B1:C3,2)")).toMatch(/VLOOKUP is not a function/);
    expect(formulaProblem("SUM(A1:A3")).toMatch(/missing its closing/);
    expect(formulaProblem("1+")).toMatch(/ends too soon/);
    expect(formulaProblem("Pass")).toMatch(/Put text in quotes/);
    expect(formulaProblem("ROUND(1,2,3)")).toMatch(/ROUND takes 1 to 2 values/);
    expect(formulaProblem('"open')).toMatch(/closing quote/);
  });
  it("the server refuses a layout with a bad formula and names the cell", () => {
    const structure = {
      kind: "grid",
      sheets: [{ name: "Readings", colWidths: [80, 80], rowHeights: [20], cells: [[{ value: "", locked: true, rowSpan: 1, colSpan: 1, style: {}, formula: "SUMX(A1)" }, { value: "", locked: false, rowSpan: 1, colSpan: 1, style: {} }]] }],
    };
    expect(gridStructureError(structure)).toMatch(/Sheet 1 \("Readings"\), cell A1: the formula =SUMX\(A1\) cannot be saved\. SUMX is not a function/);
  });
});

describe("formula engine: display", () => {
  it("decimals change only what is shown", () => {
    expect(displayValue(2.34567, 2)).toBe("2.35");
    expect(displayValue(2, 3)).toBe("2.000");
    expect(displayValue(0.1 + 0.2)).toBe("0.3");
    expect(displayValue(true)).toBe("TRUE");
    expect(displayValue(null)).toBe("");
  });
});

describe("formula engine: rows and columns inserted or deleted", () => {
  it("inserting a row moves references below it, absolute ones too", () => {
    const change = { axis: "row", kind: "insert", at: 2, count: 1 } as const;
    expect(rewriteFormula("A1+A2+$B$3", change)).toBe("A1+A3+$B$4");
    expect(rewriteFormula("SUM(A1:A5)", change)).toBe("SUM(A1:A6)");
    expect(rewriteFormula('=A2&"A2"', change)).toBe('=A3&"A2"');
    expect(rewriteFormula("ROUND(A2,1)", change)).toBe("ROUND(A3,1)");
  });
  it("inserting a column moves letters", () => {
    expect(rewriteFormula("A1+B1+C1", { axis: "col", kind: "insert", at: 2, count: 2 })).toBe("A1+D1+E1");
  });
  it("deleting makes references to the deleted cells #REF! and shrinks ranges", () => {
    const change = { axis: "row", kind: "delete", from: 2, to: 3 } as const;
    expect(rewriteFormula("A1+A2", change)).toBe("A1+#REF!");
    expect(rewriteFormula("A5*2", change)).toBe("A3*2");
    expect(rewriteFormula("SUM(A1:A5)", change)).toBe("SUM(A1:A3)");
    expect(rewriteFormula("SUM(A2:A3)", change)).toBe("SUM(#REF!)");
    expect(rewriteFormula("SUM(A3:A6)", change)).toBe("SUM(A2:A4)");
    expect(evaluateGrid({ A1: "=" + rewriteFormula("A2+1", change) })["A1"]).toBe(ERR_REF);
    expect(rewriteFormula("SUM(B1:D1)", { axis: "col", kind: "delete", from: 1, to: 1 })).toBe("SUM(A1:C1)");
  });
  it("a formula that cannot be read is left as it was", () => {
    expect(rewriteFormula('"open', { axis: "row", kind: "insert", at: 1, count: 1 })).toBe('"open');
  });
});

describe("filled copy: the server works out formula cells", () => {
  const cell = (extra: Record<string, unknown>) => ({ value: "", locked: false, rowSpan: 1, colSpan: 1, style: {}, ...extra });
  const structure = {
    kind: "grid",
    sheets: [
      {
        name: "S",
        colWidths: [80, 80, 80, 80],
        rowHeights: [20],
        cells: [[cell({ type: "number" }), cell({ type: "number" }), cell({ formula: "ROUND(A1/B1,2)", locked: true, decimals: 3 }), cell({ value: "Label", locked: true })]],
      },
    ],
  };
  it("ignores client values for formula and label cells and stores the result", () => {
    const out = recomputeGridAnswers(structure, { "0!A1": "10", "0!B1": "3", "0!C1": "999", "0!D1": "changed" })!;
    expect(out["0!C1"]).toBe("3.330");
    expect(out["0!D1"]).toBeUndefined();
    expect(out["0!A1"]).toBe("10");
  });
  it("keeps typed text in a number cell and shows #VALUE! in the formula", () => {
    const out = recomputeGridAnswers(structure, { "0!A1": "ten", "0!B1": "3" })!;
    expect(out["0!A1"]).toBe("ten");
    expect(out["0!C1"]).toBe(ERR_VALUE);
  });
  it("shows #DIV/0! when the divisor is blank", () => {
    expect(recomputeGridAnswers(structure, { "0!A1": "1" })!["0!C1"]).toBe(ERR_DIV0);
  });
  it("is not used for other form kinds", () => {
    expect(recomputeGridAnswers({ kind: "fields" }, { a: "1" })).toBeNull();
  });
});
