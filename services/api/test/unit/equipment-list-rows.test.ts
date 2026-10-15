import { describe, expect, it } from "vitest";
import { addDataRow, dropEmptyDataRows, dropPlaceholderEquipmentRows, freshSheets, insertDataRow, LISTS } from "../../src/modules/controlled-lists/logic.js";
import { cellAddr, type StoredSheet } from "../../src/modules/controlled-lists/math.js";

const SHEET = LISTS["lst-eqp-001"].formula!.sheet;

function withRows(rows: Array<Record<string, string | number>>): StoredSheet[] {
  const sheets = freshSheets("lst-eqp-001");
  let current = sheets;
  for (const values of rows) {
    const added = addDataRow("lst-eqp-001", current, SHEET)!;
    current = added.sheets;
    const sheet = current.find((item) => item.name === SHEET)!;
    for (const [col, v] of Object.entries(values)) sheet.cells[cellAddr(col, added.row)] = { ...sheet.cells[cellAddr(col, added.row)], kind: "input", v };
    // Rows copied in from equipment records are not marked as added in the app.
    if (Object.keys(values).length) delete sheet.cells[cellAddr("A", added.row)]!.kept;
  }
  return current;
}

const rowsWith = (sheets: StoredSheet[], text: string) => {
  const sheet = sheets.find((item) => item.name === SHEET)!;
  return Object.entries(sheet.cells).filter(([, cell]) => cell.v === text).map(([addr]) => addr);
};

describe("Master Equipment List rows", () => {
  it("keeps a blank row added in the app when the list is opened again, with its Next Cal Due formula", () => {
    const base = freshSheets("lst-eqp-001");
    const added = addDataRow("lst-eqp-001", base, SHEET)!;
    const cleaned = dropEmptyDataRows("lst-eqp-001", added.sheets);
    const sheet = cleaned.sheets.find((item) => item.name === SHEET)!;
    expect(sheet.cells[cellAddr("A", added.row)]?.kept).toBe(true);
    expect(sheet.cells[cellAddr("I", added.row)]?.f).toBe(`H${added.row}+(G${added.row}*30)`);
    const inserted = insertDataRow("lst-eqp-001", base, SHEET, LISTS["lst-eqp-001"].dataStart[SHEET]!)!;
    expect(inserted.sheets.find((item) => item.name === SHEET)!.cells[cellAddr("A", inserted.row)]?.kept).toBe(true);
  });

  it("removes only untouched placeholder rows whose equipment record is gone", () => {
    const sheets = withRows([
      { A: "91", B: "Calibration Record", G: 12, J: "Active" },
      { A: "92", B: "Calibration Equipment Register", G: 12, J: "Active" },
      { A: "93", B: "Calibration Record", G: 12, J: "Active", D: "SN-1" },
      { A: "94", B: "Calibration Record", G: 12, J: "Active" },
      { A: "DMA-200", B: "Calibration Record", G: 12, J: "Active" },
      { A: "95", B: "Height Gage", G: 12, J: "Active" },
      { A: "96", B: "Calibration Record", G: 6, J: "Active" },
    ]);
    const result = dropPlaceholderEquipmentRows(sheets, new Set(["94"]));
    expect(result.removed).toEqual(["91", "92"]);
    expect(rowsWith(result.sheets, "93")).toHaveLength(1);
    expect(rowsWith(result.sheets, "94")).toHaveLength(1);
    expect(rowsWith(result.sheets, "DMA-200")).toHaveLength(1);
    expect(rowsWith(result.sheets, "95")).toHaveLength(1);
    expect(rowsWith(result.sheets, "96")).toHaveLength(1);
    expect(rowsWith(result.sheets, "91")).toHaveLength(0);
    // The formula on every remaining row still points at its own row.
    const sheet = result.sheets.find((item) => item.name === SHEET)!;
    for (const [addr, cell] of Object.entries(sheet.cells)) {
      if (!addr.startsWith("I") || !cell.f) continue;
      const row = addr.slice(1);
      expect(cell.f).toBe(`H${row}+(G${row}*30)`);
    }
    expect(dropPlaceholderEquipmentRows(result.sheets, new Set(["94"])).removed).toEqual([]);
  });
});
