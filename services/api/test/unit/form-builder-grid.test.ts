import { describe, expect, it } from "vitest";
import { checkCellInput } from "../../src/modules/form-builder/cellInput.js";
import { gridStructureError, validateGridStructure } from "../../src/modules/form-builder/gridStructure.js";
import { descriptionOf } from "../../src/modules/form-builder/revision.js";

type Cell = Record<string, unknown> | null;

const cell = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ value: "", locked: false, rowSpan: 1, colSpan: 1, style: {}, ...extra });

function sheet(rows: number, cols: number, patch?: (cells: Cell[][]) => void, name = "Sheet1") {
  const cells: Cell[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => cell()));
  patch?.(cells);
  return { name, colWidths: Array(cols).fill(100), rowHeights: Array(rows).fill(24), cells };
}

const grid = (...sheets: unknown[]) => ({ kind: "grid", sheets });

describe("validateGridStructure", () => {
  it("accepts an older grid that has no cell types", () => {
    expect(gridStructureError(grid(sheet(4, 3)))).toBeNull();
    expect(() => validateGridStructure(grid(sheet(4, 3)))).not.toThrow();
  });

  it("accepts typed cells, a clean merge and valid borders and colors", () => {
    const good = sheet(4, 4, (cells) => {
      cells[0]![0] = cell({ rowSpan: 2, colSpan: 2, type: "label", locked: true, style: { background: "#0A3C7B", color: "#ffffff", borderTop: "2px solid #111111", borderLeft: "1px dashed currentColor", align: "center", valign: "middle", bold: true } });
      cells[0]![1] = null;
      cells[1]![0] = null;
      cells[1]![1] = null;
      cells[2]![0] = cell({ type: "number", decimals: 2, min: 0, max: 10 });
      cells[2]![1] = cell({ type: "dropdown", options: ["Yes", "No"] });
      cells[2]![2] = cell({ type: "passfail" });
      cells[2]![3] = cell({ type: "signature" });
      cells[3]![0] = cell({ type: "date" });
    });
    expect(gridStructureError(grid(good))).toBeNull();
  });

  it("rejects overlapping merges and says where", () => {
    const bad = sheet(4, 4, (cells) => {
      cells[0]![0] = cell({ rowSpan: 2, colSpan: 2 });
      cells[0]![1] = null;
      cells[1]![0] = null;
      cells[1]![1] = cell({ rowSpan: 2, colSpan: 2 });
    });
    expect(gridStructureError(grid(bad))).toMatch(/^Sheet 1 \("Sheet1"\), cell B2: the merge overlaps the merge at A1/);
  });

  it("rejects a merge that goes outside the grid", () => {
    const bad = sheet(2, 2, (cells) => {
      cells[1]![1] = cell({ rowSpan: 2 });
    });
    expect(gridStructureError(grid(bad))).toMatch(/cell B2: the merge goes outside the sheet/);
  });

  it("rejects spans below 1", () => {
    expect(gridStructureError(grid(sheet(2, 2, (cells) => { cells[0]![0] = cell({ rowSpan: 0 }); })))).toMatch(/cell A1: the row span/);
    expect(gridStructureError(grid(sheet(2, 2, (cells) => { cells[0]![0] = cell({ colSpan: -1 }); })))).toMatch(/cell A1: the column span/);
  });

  it("requires covered cells to be empty", () => {
    const bad = sheet(2, 2, (cells) => {
      cells[0]![0] = cell({ colSpan: 2 });
    });
    expect(gridStructureError(grid(bad))).toMatch(/cell B1 is covered by the merge at A1 and must be empty/);
  });

  it("rejects bad colors and borders", () => {
    expect(gridStructureError(grid(sheet(2, 2, (cells) => { cells[0]![1] = cell({ style: { background: "red" } }); })))).toMatch(/cell B1: the fill color must look like #RRGGBB/);
    expect(gridStructureError(grid(sheet(2, 2, (cells) => { cells[0]![1] = cell({ style: { color: "#12345" } }); })))).toMatch(/text color/);
    expect(gridStructureError(grid(sheet(2, 2, (cells) => { cells[1]![0] = cell({ style: { borderTop: "5px solid #000000" } }); })))).toMatch(/cell A2: the top border/);
    expect(gridStructureError(grid(sheet(2, 2, (cells) => { cells[1]![0] = cell({ style: { borderLeft: "1px solid red" } }); })))).toMatch(/left border/);
  });

  it("rejects a bad cell type and bad dropdown options", () => {
    expect(gridStructureError(grid(sheet(2, 2, (cells) => { cells[0]![0] = cell({ type: "checkbox" }); })))).toMatch(/cell A1: the cell type must be one of/);
    expect(gridStructureError(grid(sheet(2, 2, (cells) => { cells[0]![0] = cell({ type: "dropdown" }); })))).toMatch(/needs 1 to 50 options/);
    expect(gridStructureError(grid(sheet(2, 2, (cells) => { cells[0]![0] = cell({ type: "dropdown", options: ["A", " "] }); })))).toMatch(/cannot be empty/);
    expect(gridStructureError(grid(sheet(2, 2, (cells) => { cells[0]![0] = cell({ type: "dropdown", options: Array.from({ length: 51 }, (_, i) => `Option ${i}`) }); })))).toMatch(/1 to 50/);
  });

  it("rejects number settings that are out of range", () => {
    expect(gridStructureError(grid(sheet(2, 2, (cells) => { cells[0]![0] = cell({ type: "number", decimals: 7 }); })))).toMatch(/decimals/);
    expect(gridStructureError(grid(sheet(2, 2, (cells) => { cells[0]![0] = cell({ type: "number", min: 5, max: 1 }); })))).toMatch(/minimum is more than the maximum/);
  });

  it("limits sheets, rows and columns", () => {
    expect(gridStructureError(grid())).toMatch(/at least one sheet/);
    expect(gridStructureError(grid(...Array.from({ length: 11 }, (_, i) => sheet(1, 1, undefined, `S${i}`))))).toMatch(/at most 10/);
    expect(gridStructureError(grid(sheet(501, 1)))).toMatch(/Sheet 1 \("Sheet1"\) has 501 rows. A sheet can have at most 500/);
    expect(gridStructureError(grid(sheet(1, 61)))).toMatch(/61 columns/);
    expect(gridStructureError(grid(sheet(500, 60)))).toBeNull();
  });

  it("checks that widths and heights match the grid and stay between 8 and 1000", () => {
    const short = { ...sheet(3, 3), rowHeights: [24, 24] };
    expect(gridStructureError(grid(short))).toMatch(/3 rows but 2 row heights/);
    const wrongCols = sheet(3, 3);
    wrongCols.cells[1] = [cell(), cell()];
    expect(gridStructureError(grid(wrongCols))).toMatch(/row 2 has 2 cells but the sheet has 3 columns/);
    expect(gridStructureError(grid({ ...sheet(2, 2), colWidths: [100, 7] }))).toMatch(/column width outside 8 to 1000/);
    expect(gridStructureError(grid({ ...sheet(2, 2), colWidths: [100, 1001] }))).toMatch(/column width outside/);
    expect(gridStructureError(grid({ ...sheet(2, 2), rowHeights: [8, 1000] }))).toBeNull();
    expect(gridStructureError(grid({ ...sheet(2, 2), rowHeights: [24, 5] }))).toMatch(/row height outside/);
  });

  it("names the sheet and returns a 400 from validateGridStructure", () => {
    const second = sheet(2, 2, (cells) => { cells[0]![0] = cell({ type: "nope" }); }, "Results");
    expect(() => validateGridStructure(grid(sheet(1, 1), second))).toThrow(/Sheet 2 \("Results"\), cell A1/);
    try {
      validateGridStructure(grid(second));
    } catch (error) {
      expect((error as { statusCode?: number; status?: number }).statusCode ?? (error as { status?: number }).status).toBe(400);
    }
  });
});

describe("checkCellInput", () => {
  it("rejects text in a number cell, with a message and the text kept by the caller", () => {
    const result = checkCellInput({ type: "number" }, "abc");
    expect(result).toEqual({ ok: false, message: "Enter a number" });
    expect(checkCellInput({ type: "number" }, "12abc").ok).toBe(false);
    expect(checkCellInput({ type: "number" }, "1e").ok).toBe(false);
  });

  it("accepts numbers, including negatives and exponents, and an empty entry", () => {
    expect(checkCellInput({ type: "number" }, " 12.5 ")).toEqual({ ok: true, value: "12.5" });
    expect(checkCellInput({ type: "number" }, "-3")).toEqual({ ok: true, value: "-3" });
    expect(checkCellInput({ type: "number" }, "1e3").ok).toBe(true);
    expect(checkCellInput({ type: "number" }, "")).toEqual({ ok: true, value: "" });
  });

  it("checks min and max", () => {
    const rules = { type: "number" as const, min: 1, max: 10 };
    expect(checkCellInput(rules, "0.5")).toEqual({ ok: false, message: "Enter a number that is 1 or more" });
    expect(checkCellInput(rules, "11")).toEqual({ ok: false, message: "Enter a number that is 10 or less" });
    expect(checkCellInput(rules, "1").ok).toBe(true);
    expect(checkCellInput(rules, "10").ok).toBe(true);
  });

  it("checks decimals without rounding", () => {
    expect(checkCellInput({ type: "number", decimals: 2 }, "1.234")).toEqual({ ok: false, message: "Use at most 2 decimal places" });
    expect(checkCellInput({ type: "number", decimals: 2 }, "1.23")).toEqual({ ok: true, value: "1.23" });
    expect(checkCellInput({ type: "number", decimals: 0 }, "2.5")).toEqual({ ok: false, message: "Enter a whole number" });
    expect(checkCellInput({ type: "number", decimals: 1 }, "2.55").ok).toBe(false);
  });

  it("accepts only a real ISO date", () => {
    expect(checkCellInput({ type: "date" }, "2026-02-28")).toEqual({ ok: true, value: "2026-02-28" });
    expect(checkCellInput({ type: "date" }, "2024-02-29").ok).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "2026-2-3", "02/03/2026", "tomorrow"]) {
      expect(checkCellInput({ type: "date" }, bad)).toEqual({ ok: false, message: "Enter a date as YYYY-MM-DD" });
    }
  });

  it("accepts a dropdown value only from its options", () => {
    const rules = { type: "dropdown" as const, options: ["Open", "Closed"] };
    expect(checkCellInput(rules, "Open")).toEqual({ ok: true, value: "Open" });
    expect(checkCellInput(rules, "open")).toEqual({ ok: false, message: "Choose one of: Open, Closed" });
    expect(checkCellInput(rules, "Pending").ok).toBe(false);
  });

  it("accepts Pass or Fail, and anything in a text or label cell", () => {
    expect(checkCellInput({ type: "passfail" }, "Pass").ok).toBe(true);
    expect(checkCellInput({ type: "passfail" }, "failed").ok).toBe(true);
    expect(checkCellInput({ type: "passfail" }, "maybe").ok).toBe(false);
    expect(checkCellInput({ type: "text" }, "anything at all").ok).toBe(true);
    expect(checkCellInput({}, "anything").ok).toBe(true);
  });
});

describe("descriptionOf", () => {
  it("takes the person's words from a change summary and leaves other summaries whole", () => {
    expect(descriptionOf("Ana Cruz changed FRM-1 Intake from REV A to REV B on Oct 14, 2026, 3:45 PM: Added a signature row.")).toBe("Added a signature row.");
    expect(descriptionOf("Ana Cruz saved the structure of \"Intake\" on Oct 14, 2026, 3:45 PM. Revision stays A.")).toBe("Ana Cruz saved the structure of \"Intake\" on Oct 14, 2026, 3:45 PM. Revision stays A.");
  });
});
