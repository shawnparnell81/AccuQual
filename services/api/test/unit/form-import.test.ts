import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { planFormImport } from "../../src/modules/form-import/formImport.execute.js";
import { matchScore, suggestMapping } from "../../src/modules/form-import/formImport.match.js";
import { interpretGrid, parseImportFile, type GridCell, type ParsedGrid } from "../../src/modules/form-import/formImport.parse.js";
import { getFormImportTemplate } from "../../src/modules/form-import/formImport.templates.js";
import type { Db } from "../../src/lib/requestDb.js";

const master = getFormImportTemplate("lst-gen-001")!;
const csa = getFormImportTemplate("frm-val-001")!;
const noDb = {} as Db;

function cell(text: string, extra?: Partial<GridCell>): GridCell {
  return { text, bold: false, filled: false, fromFormula: false, rowSpan: 1, colSpan: 1, covered: false, ...extra };
}

function blank(): GridCell {
  return cell("");
}

describe("form import parsing", () => {
  it("reads a csv table and skips a title line", async () => {
    const csv = Buffer.from("Master Document List\nDocument Title,Current Rev,Location / Folder\nTorque procedure,Rev B,Quality\n");
    const grid = await parseImportFile(csv, "list.csv");
    const interpreted = interpretGrid(grid, master);
    expect(interpreted.mode).toBe("rows");
    expect(interpreted.notes.some((note) => note.includes("title"))).toBe(true);
    expect(interpreted.columns.map((column) => column.header)).toEqual(["Document Title", "Current Rev", "Location / Folder"]);
    expect(interpreted.records).toEqual([{ rowNumber: 3, cells: ["Torque procedure", "Rev B", "Quality"] }]);
    const mapping = suggestMapping(master.fields, interpreted.columns);
    expect(mapping.find((entry) => entry.fieldKey === "title")).toMatchObject({ columnIndex: 0, confidence: 1, reason: "Exact match" });
    expect(mapping.find((entry) => entry.fieldKey === "revision")?.columnIndex).toBe(1);
    expect(mapping.find((entry) => entry.fieldKey === "location")?.columnIndex).toBe(2);
  });

  it("reads json records", async () => {
    const file = Buffer.from(JSON.stringify([{ "Document Title": "Gauge WI", "Current Rev": "Rev A" }]));
    const interpreted = interpretGrid(await parseImportFile(file, "list.json"), master);
    expect(interpreted.records[0]?.cells[0]).toBe("Gauge WI");
    expect(suggestMapping(master.fields, interpreted.columns).find((entry) => entry.fieldKey === "title")?.confidence).toBe(1);
  });

  it("refuses a word file", async () => {
    await expect(parseImportFile(Buffer.from("not a document"), "procedure.docx")).rejects.toThrow(/Word files are not imported/);
  });

  it("keeps formula results, merged titles, and a two-row colored header", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("List");
    sheet.mergeCells("A1:D2");
    sheet.getCell("A1").value = "ACCUQUAL MASTER DOCUMENT LIST";
    sheet.getCell("A1").font = { bold: true, size: 18 };
    for (const [index, text] of ["Document", "Document", "Current", "Location"].entries()) {
      const header = sheet.getCell(3, index + 1);
      header.value = text;
      header.font = { bold: true, color: { argb: "FFFFFFFF" } };
      header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
    }
    for (const [index, text] of ["ID", "Title", "Rev", "Folder"].entries()) {
      const header = sheet.getCell(4, index + 1);
      header.value = text;
      header.font = { bold: true };
      header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD6E3F0" } };
    }
    sheet.getCell("A5").value = "WI-12";
    sheet.getCell("B5").value = "Torque procedure";
    sheet.getCell("C5").value = { formula: '"Rev "&"B"', result: "Rev B" };
    sheet.getCell("D5").value = "Quality";
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const grid = await parseImportFile(buffer, "master.xlsx");
    expect(grid.notes.some((note) => note.startsWith("Expanded"))).toBe(true);
    expect(grid.notes.some((note) => note.includes("calculated values"))).toBe(true);
    const interpreted = interpretGrid(grid, master);
    expect(interpreted.notes.some((note) => note.includes("multi-row"))).toBe(true);
    expect(interpreted.columns.map((column) => column.header)).toEqual(["Document / ID", "Document / Title", "Current / Rev", "Location / Folder"]);
    expect(interpreted.records[0]?.cells).toEqual(["WI-12", "Torque procedure", "Rev B", "Quality"]);
    const mapping = suggestMapping(master.fields, interpreted.columns);
    expect(mapping.find((entry) => entry.fieldKey === "documentId")?.columnIndex).toBe(0);
    expect(mapping.find((entry) => entry.fieldKey === "title")?.columnIndex).toBe(1);
    expect(mapping.find((entry) => entry.fieldKey === "revision")?.columnIndex).toBe(2);
    expect(mapping.find((entry) => entry.fieldKey === "location")?.columnIndex).toBe(3);
  });

  it("reads a dense CSA sheet as one record and maps real cell keys", () => {
    const grid: ParsedGrid = {
      sheetName: "Test Report",
      originRow: 1,
      notes: [],
      cells: [
        [cell("CSA VALIDATION REPORT", { bold: true, colSpan: 7 }), ...Array.from({ length: 6 }, () => ({ ...blank(), covered: true }))],
        [cell("Doc ID:"), cell("Rev: C", { colSpan: 3 }), blank(), blank(), cell("Effective Date: 03/26/2026"), cell("Approved By:"), cell("Maxwell Tollefson")],
        [cell("DMA Part Number:"), cell("CSA-100", { colSpan: 3 }), blank(), blank(), cell("Drawing Number:"), cell("DWG-100")],
        [cell("Supplier / Factory:"), cell("Sensen"), blank(), blank(), cell("Batch Number:"), cell("BATCH-1")],
        [cell("Inspected By:"), cell("Shawn Parnell"), blank(), blank(), cell("Inspection Date"), cell("2026-03-26")],
        [cell("2.0 STRUT PHYSICALS", { bold: true, colSpan: 7 })],
        ["Criteria", "Nominal", "Tolorences", "Sample 1", "Sample 2", "Pass / Fail sample 1", "Pass / Fail Sample 2"].map((text) => cell(text, { bold: true, filled: true })),
        [cell("Hardwear Grade"), cell("10"), cell("="), cell("10"), cell("10"), cell("Passed", { fromFormula: true }), cell("Passed", { fromFormula: true })],
        [cell("OVERALL DISPOSITION SAMPLE 1:"), cell("TRUE"), cell("Pass"), cell(""), cell("Fail"), cell(""), cell("Conditional Pass")],
        [cell("Notes:"), cell("Samples meet the drawing.")],
      ],
    };
    const interpreted = interpretGrid(grid, csa);
    expect(interpreted.mode).toBe("record");
    expect(interpreted.records).toHaveLength(1);
    const mapping = suggestMapping(csa.fields, interpreted.columns);
    const valueFor = (key: string) => {
      const column = mapping.find((entry) => entry.fieldKey === key)?.columnIndex;
      return column == null ? "" : interpreted.records[0]!.cells[column];
    };
    expect(valueFor("B6")).toBe("CSA-100");
    expect(valueFor("F6")).toBe("DWG-100");
    expect(valueFor("B7")).toBe("Sensen");
    expect(valueFor("F7")).toBe("BATCH-1");
    expect(valueFor("B8")).toBe("Shawn Parnell");
    expect(valueFor("F8")).toBe("2026-03-26");
    expect(valueFor("G2")).toBe("Maxwell Tollefson");
    expect(valueFor("D12")).toBe("10");
    expect(valueFor("B12")).toBe("10");
    expect(valueFor("C12")).toBe("=");
    expect(valueFor("B49")).toBe("TRUE");
    expect(valueFor("B52")).toBe("Samples meet the drawing.");
    expect(mapping.some((entry) => entry.fieldKey === "F12")).toBe(false);
  });
});

describe("form import mapping", () => {
  it("prefers an exact alias over a shorter similar name", () => {
    const title = master.fields.find((field) => field.key === "title")!;
    const documentId = master.fields.find((field) => field.key === "documentId")!;
    expect(matchScore("Document Title", title)).toBe(1);
    expect(matchScore("Part Number", csa.fields.find((field) => field.key === "B6")!)).toBeGreaterThan(0.8);
    expect(matchScore("Document Title", documentId)).toBeLessThan(matchScore("Document Title", title));
    const columns = [
      { index: 0, header: "Doc Title", samples: [] },
      { index: 1, header: "Rev", samples: [] },
    ];
    const mapping = suggestMapping(master.fields, columns);
    expect(mapping.find((entry) => entry.fieldKey === "title")?.columnIndex).toBe(0);
    expect(mapping.find((entry) => entry.fieldKey === "revision")?.columnIndex).toBe(1);
    expect(mapping.filter((entry) => entry.columnIndex === 0)).toHaveLength(1);
  });

  it("does not invent a number for a template row and still requires a title", async () => {
    const skipped = await planFormImport(noDb, master, [{ rowNumber: 4, cells: ["FRM-VAL-001", "CSA VALIDATION REPORT"] }], {
      documentId: 0,
      title: 1,
      revision: null,
      location: null,
      notes: null,
    });
    expect(skipped[0]).toMatchObject({ action: "skip" });
    expect(skipped[0]?.summary).toMatch(/form template/);

    const missing = await planFormImport(noDb, master, [{ rowNumber: 5, cells: ["Quality"] }], {
      documentId: null,
      title: null,
      revision: null,
      location: 0,
      notes: null,
    });
    expect(missing[0]?.action).toBe("skip");
    expect(missing[0]?.issues.join(" ")).toMatch(/Document Title/);
  });
});
