import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blankCell, evaluatedSheet, shownCell, type FormSheet } from "./formGrid.ts";
import { deleteRows, insertColumns, insertRows } from "./formGridEdit.ts";
import { recomputeGridAnswers } from "../../../../services/api/src/modules/form-builder/gridFill.ts";

function sheetOf(rows: number, cols: number): FormSheet {
  return {
    name: "S",
    colWidths: Array(cols).fill(80),
    rowHeights: Array(rows).fill(20),
    cells: Array.from({ length: rows }, () => Array.from({ length: cols }, () => blankCell())),
  };
}

describe("grid formulas on screen", () => {
  it("match what the server stores when the copy is saved", () => {
    const sheet = sheetOf(4, 3);
    sheet.cells[0]![0] = { ...blankCell(), type: "number" };
    sheet.cells[1]![0] = { ...blankCell(), type: "number" };
    sheet.cells[2]![0] = { ...blankCell(), formula: "SUM(A1:A2)", locked: true };
    sheet.cells[3]![0] = { ...blankCell(), formula: 'IF(A3>10,"Pass","Fail")', locked: true };
    sheet.cells[0]![1] = { ...blankCell(), formula: "AVERAGE(A1:A2)", locked: true, decimals: 2 };
    sheet.cells[1]![1] = { ...blankCell(), formula: "A1/A5", locked: true };
    const answers = { "0!A1": "4.5", "0!A2": "7" };
    const calculated = evaluatedSheet(sheet, answers, "0");
    const server = recomputeGridAnswers({ kind: "grid", sheets: [sheet] }, answers)!;
    for (const [row, col] of [[2, 0], [3, 0], [0, 1], [1, 1]] as const) {
      const key = `0!${String.fromCharCode(65 + col)}${row + 1}`;
      assert.equal(shownCell(sheet.cells[row]![col]!, calculated, col + 1, row + 1), server[key], key);
    }
    assert.equal(server["0!A3"], "11.5");
    assert.equal(server["0!A4"], "Pass");
    assert.equal(server["0!B1"], "5.75");
    assert.equal(server["0!B2"], "#REF!");
  });

  it("follow inserted and deleted rows and columns", () => {
    const sheet = sheetOf(4, 2);
    sheet.cells[3]![1] = { ...blankCell(), formula: "SUM(A1:A3)+A2", locked: true };
    const inserted = insertRows(sheet, 1)!;
    assert.equal(inserted.cells[4]![1]!.formula, "SUM(A1:A4)+A3");
    const wider = insertColumns(inserted, 0)!;
    assert.equal(wider.cells[4]![2]!.formula, "SUM(B1:B4)+B3");
    const removed = deleteRows(wider, 2, 2)!;
    assert.equal(removed.cells[3]![2]!.formula, "SUM(B1:B3)+#REF!");
  });
});
