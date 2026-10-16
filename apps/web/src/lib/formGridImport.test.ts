import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { gridImportFromSheets } from "./formGrid.ts";
import { loadEditableSpreadsheet } from "./spreadsheetPreview.ts";
import { gridStructureError } from "../../../../services/api/src/modules/form-builder/gridStructure.ts";

async function workbook(build: (wb: ExcelJS.Workbook) => void) {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  const result = gridImportFromSheets(await loadEditableSpreadsheet(buffer, "test.xlsx"));
  assert.equal(gridStructureError(result.structure), null, "the API accepts every imported layout as it is");
  return result;
}

describe("xlsx import as a starting layout", () => {
  it("keeps merges, widths, heights, borders, fills and fonts in the format the API accepts", async () => {
    const { structure, notes } = await workbook((wb) => {
      const ws = wb.addWorksheet("Inspection");
      ws.mergeCells("A1:C1");
      ws.getCell("A1").value = "Receiving Inspection";
      ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF1F4E79" } };
      ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEBF7" } };
      ws.getCell("A2").border = { top: { style: "thin" }, bottom: { style: "thick", color: { argb: "FFFF0000" } }, left: { style: "dashed" }, right: { style: "double" } };
      ws.getColumn(2).width = 30;
      ws.getRow(2).height = 30;
    });
    assert.deepEqual(notes, []);
    const sheet = structure.sheets[0]!;
    assert.equal(sheet.name, "Inspection");
    assert.equal(sheet.cells[0]![0]!.colSpan, 3);
    assert.equal(sheet.cells[0]![1], null);
    assert.equal(sheet.cells[0]![0]!.style.bold, true);
    assert.equal(sheet.cells[0]![0]!.style.background, "#ddebf7");
    assert.equal(sheet.cells[0]![0]!.style.color, "#1f4e79");
    const border = sheet.cells[1]![0]!.style;
    for (const edge of [border.borderTop, border.borderBottom, border.borderLeft, border.borderRight]) {
      assert.match(edge ?? "", /^[1-3]px (solid|dashed|double|dotted) (#[0-9a-f]{6}|currentColor)$/);
    }
    assert.equal(border.borderBottom, "3px solid #ff0000");
    assert.ok(sheet.colWidths[1]! > sheet.colWidths[0]!);
    assert.equal(sheet.rowHeights[1], 40);
  });

  it("brings filled-down formulas in with their own references, not the first cell's address", async () => {
    const { structure, notes } = await workbook((wb) => {
      const ws = wb.addWorksheet("S");
      ws.getCell("A1").value = 1;
      ws.getCell("A2").value = 2;
      ws.getCell("A3").value = 3;
      ws.fillFormula("B1:B3", "A1*2", [2, 4, 6]);
      ws.getCell("C1").value = { formula: "SUM(A1:A3)", result: 6 };
    });
    assert.deepEqual(notes, []);
    const cells = structure.sheets[0]!.cells;
    assert.deepEqual([cells[0]![1]!.formula, cells[1]![1]!.formula, cells[2]![1]!.formula], ["A1*2", "A2*2", "A3*2"]);
    assert.equal(cells[0]![2]!.formula, "SUM(A1:A3)");
    assert.equal(cells[0]![2]!.locked, true);
  });

  it("lists formulas the form cannot calculate and leaves them out rather than guessing", async () => {
    const { structure, notes } = await workbook((wb) => {
      const ws = wb.addWorksheet("S");
      wb.addWorksheet("Other").getCell("A1").value = 5;
      ws.getCell("A1").value = { formula: "VLOOKUP(B1,Other!A:B,2,FALSE)", result: 3 };
      ws.getCell("A2").value = { formula: "Other!A1+1", result: 6 };
      ws.getCell("A3").value = { formula: "ROUND(1.25,1)", result: 1.3 };
    });
    assert.equal(notes.length, 2);
    assert.deepEqual(notes.map((note) => [note.sheet, note.cell]), [["S", "A1"], ["S", "A2"]]);
    assert.match(notes[0]!.reason, /VLOOKUP/);
    assert.match(notes[1]!.reason, /another sheet/);
    const cells = structure.sheets[0]!.cells;
    assert.equal(cells[0]![0]!.formula, undefined);
    assert.equal(cells[0]![0]!.value, "", "the old result is not kept as if it were typed");
    assert.equal(cells[2]![0]!.formula, "ROUND(1.25,1)");
  });

  it("turns Excel data validation into dropdown, number and date cells", async () => {
    const { structure } = await workbook((wb) => {
      const ws = wb.addWorksheet("S");
      ws.getCell("H1").value = "Pass";
      ws.getCell("H2").value = "Fail";
      ws.getCell("A1").dataValidation = { type: "list", allowBlank: true, formulae: ['"Yes,No,N/A"'] };
      ws.getCell("A2").dataValidation = { type: "list", allowBlank: true, formulae: ["$H$1:$H$2"] };
      ws.getCell("A3").dataValidation = { type: "decimal", operator: "between", allowBlank: true, formulae: [0, 10] };
      ws.getCell("A4").dataValidation = { type: "whole", operator: "greaterThanOrEqual", allowBlank: true, formulae: [1] };
      ws.getCell("A5").dataValidation = { type: "date", operator: "greaterThan", allowBlank: true, formulae: [new Date(2020, 0, 1)] };
    });
    const cells = structure.sheets[0]!.cells;
    assert.deepEqual([cells[0]![0]!.type, cells[0]![0]!.options, cells[0]![0]!.locked], ["dropdown", ["Yes", "No", "N/A"], false]);
    assert.deepEqual(cells[1]![0]!.options, ["Pass", "Fail"]);
    assert.deepEqual([cells[2]![0]!.type, cells[2]![0]!.min, cells[2]![0]!.max], ["number", 0, 10]);
    assert.deepEqual([cells[3]![0]!.type, cells[3]![0]!.decimals, cells[3]![0]!.min], ["number", 0, 1]);
    assert.equal(cells[4]![0]!.type, "date");
  });

  it("trims empty trailing rows and columns and reports what does not fit the grid limits", async () => {
    const { structure, notes } = await workbook((wb) => {
      const ws = wb.addWorksheet("Big");
      ws.getCell(620, 1).value = "last row";
      ws.getCell(1, 70).value = "last col";
      ws.getCell(1, 1).value = "start";
    });
    const sheet = structure.sheets[0]!;
    assert.equal(sheet.cells.length, 500);
    assert.equal(sheet.colWidths.length, 60);
    assert.equal(notes.length, 2);
    assert.match(notes[0]!.reason, /last 120 row/);
    assert.match(notes[1]!.reason, /last 10 column/);

    const small = await workbook((wb) => {
      const ws = wb.addWorksheet("Small");
      ws.getCell("B2").value = "x";
      ws.getRow(40).height = 20;
    });
    assert.equal(small.structure.sheets[0]!.cells.length, 2);
    assert.equal(small.structure.sheets[0]!.colWidths.length, 2);
  });
});
