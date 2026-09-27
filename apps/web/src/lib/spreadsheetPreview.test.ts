import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import { loadSpreadsheet } from "./spreadsheetPreview.ts";

async function fmeaWorkbook(): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Process FMEA");
  sheet.mergeCells("A1:D1");
  const title = sheet.getCell("A1");
  title.value = "Process FMEA — Bracket";
  title.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  title.border = {
    top: { style: "thin", color: { argb: "FF1F4E79" } },
    left: { style: "thin", color: { argb: "FF1F4E79" } },
    bottom: { style: "thin", color: { argb: "FF1F4E79" } },
    right: { style: "thin", color: { argb: "FF1F4E79" } },
  };
  sheet.getColumn(1).width = 28;
  sheet.getRow(3).values = ["Process step", "Severity", "Occurrence", "Detection"];
  for (const column of [1, 2, 3, 4]) {
    const header = sheet.getCell(3, column);
    header.font = { bold: true, color: { argb: "FF1A1A1A" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC000" } };
    header.border = {
      top: { style: "thin", color: { argb: "FF000000" } },
      left: { style: "thin", color: { argb: "FF000000" } },
      bottom: { style: "thin", color: { argb: "FF000000" } },
      right: { style: "thin", color: { argb: "FF000000" } },
    };
  }
  sheet.getCell("A4").value = "Weld bracket";
  sheet.getCell("B4").value = 8;
  sheet.getCell("B4").numFmt = "0";
  sheet.getCell("C4").value = 0.125;
  sheet.getCell("C4").numFmt = "0.0%";
  sheet.getCell("D4").value = 1234.5;
  sheet.getCell("D4").numFmt = "#,##0.00";

  const actions = workbook.addWorksheet("Actions");
  actions.getCell("A1").value = "Owner";
  actions.getCell("A1").font = { bold: true };
  actions.getCell("B1").value = "Due";
  actions.getCell("A2").value = "Quality";

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

describe("loadSpreadsheet", () => {
  it("keeps sheets, merged titles, fills, borders, and number formats", async () => {
    const book = await loadSpreadsheet(await fmeaWorkbook(), "process-fmea.xlsx");
    assert.deepEqual(
      book.sheets.map((sheet) => sheet.name),
      ["Process FMEA", "Actions"],
    );

    const fmea = book.sheets[0]!;
    const title = fmea.rows[0]?.[0];
    assert.ok(title);
    assert.equal(title.text, "Process FMEA — Bracket");
    assert.equal(title.colSpan, 4);
    assert.equal(title.style.bold, true);
    assert.equal(title.style.background, "#1f4e79");
    assert.equal(title.style.color, "#ffffff");
    assert.equal(title.style.align, "center");
    assert.equal(title.style.borderTop, "1px solid #1f4e79");
    assert.equal(fmea.rows[0]?.[1], null);
    assert.ok((fmea.colWidths[0] ?? 0) > 80);

    const header = fmea.rows[2]?.[0];
    assert.equal(header?.text, "Process step");
    assert.equal(header?.style.background, "#ffc000");
    assert.equal(header?.style.bold, true);

    assert.equal(fmea.rows[3]?.[1]?.text, "8");
    assert.equal(fmea.rows[3]?.[2]?.text, "12.5%");
    assert.equal(fmea.rows[3]?.[3]?.text, "1,234.50");

    assert.equal(book.sheets[1]?.rows[0]?.[0]?.text, "Owner");
    assert.equal(book.sheets[1]?.rows[1]?.[0]?.text, "Quality");
  });

  it("reads a csv as one sheet", async () => {
    const csv = new TextEncoder().encode('Step,Score\n"Weld, bracket",8\n').buffer;
    const book = await loadSpreadsheet(csv, "scores.csv");
    assert.equal(book.sheets.length, 1);
    assert.equal(book.sheets[0]?.rows[0]?.[0]?.text, "Step");
    assert.equal(book.sheets[0]?.rows[1]?.[0]?.text, "Weld, bracket");
    assert.equal(book.sheets[0]?.rows[1]?.[1]?.text, "8");
  });

  it("reads an xlsx that was given an .xls name", async () => {
    const book = await loadSpreadsheet(await fmeaWorkbook(), "legacy.xls");
    assert.equal(book.sheets[0]?.rows[0]?.[0]?.text, "Process FMEA — Bracket");
  });
});
