import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { formulaSerial, shownCell } from "../src/modules/controlled-lists/math.js";
import {
  addDataRow,
  appendDocuments,
  appendEquipment,
  applyInputPatch,
  changeSummary,
  freshSheets,
  planListCleanup,
  removeDataRow,
} from "../src/modules/controlled-lists/logic.js";
import parity from "../src/modules/controlled-lists/seeds/formula-parity.json" with { type: "json" };
import { buildListWorkbook } from "../src/modules/controlled-lists/workbook.js";

describe("living controlled lists", () => {
  it("loads Shawn's rows and matches every Excel due-date formula", () => {
    const equipment = freshSheets("lst-eqp-001")[0]!;
    expect(equipment.cells.A1).toMatchObject({ v: "MASTER EQUIPMENT LIST", bold: true, size: 26 });
    expect(equipment.cells.B2).toMatchObject({ v: "Rev: A", kind: "rev" });
    expect(equipment.cells.D2).toMatchObject({ v: "2026-01-26", nf: "mm-dd-yy" });
    expect(equipment.cells.F2?.v).toBe("Maxwell Tollefson");
    expect(equipment.cells.B6?.v).toBe("Strut and Shock Dyno");
    expect(equipment.cells.D38?.comment).toBe("Quality Auditor:");
    expect(equipment.merges).toEqual(expect.arrayContaining(["A1:J1", "A3:J3", "A4:J4", "F2:J2"]));
    expect(parity).toHaveLength(59);
    for (const row of parity) {
      expect(formulaSerial(equipment, equipment.cells[row.addr]?.f ?? "")).toBe(row.serial);
    }
    expect(shownCell(equipment, "I6", new Date("2026-01-01T00:00:00Z")).tone).toBeNull();
  });

  it("keeps both document tabs, drops FRM-TST, and locks Rev on a data edit", () => {
    const sheets = freshSheets("lst-gen-001");
    expect(sheets.map((sheet) => sheet.name)).toEqual(["Internal Documents", "External Documents"]);
    const internal = sheets[0]!;
    expect(internal.cells.A1).toMatchObject({ v: "Master Document List", size: 22 });
    expect(internal.cells.D2).toMatchObject({ v: "B", kind: "rev" });
    expect(internal.cells.F2).toMatchObject({ v: "2026-01-26", nf: "d-mmm-yy" });
    expect(internal.cells.A4?.v).toBe("FRM-CAR-001");
    expect(Object.values(internal.cells).some((cell) => cell.v === "FRM-TST-001" || cell.v === "FRM-TST-002")).toBe(false);
    expect(Object.values(internal.cells).some((cell) => cell.v === "FRM-VAL-001")).toBe(true);
    const edited = applyInputPatch("lst-gen-001", sheets, [{ name: "Internal Documents", cells: { B4: { v: "Supplier CAR" }, D2: { v: "Z" } } }]);
    expect(edited.sheets[0]?.cells.B4?.v).toBe("Supplier CAR");
    expect(edited.sheets[0]?.cells.D2?.v).toBe("B");
    expect(edited.changes).toEqual([{ sheet: "Internal Documents", addr: "B4", old: expect.any(String), next: "Supplier CAR" }]);
    expect(changeSummary("Shawn", edited.changes)).toContain('B4 on Internal Documents');
  });

  it("loads the laboratory scope and appends missing register and equipment rows", () => {
    const lab = freshSheets("lst-gen-003")[0]!;
    expect(lab.cells.A1?.v).toBe("SCOPE OF LABORATORY ACTIVITIES");
    expect(lab.cells.D2).toMatchObject({ v: "A", kind: "rev" });
    expect(lab.cells.A6?.v).toBe("Mechanical & Dynamic Testing");
    expect(lab.merges).toContain("A1:F1");
    expect(lab.merges).toContain("E6:F6");

    const appended = appendDocuments(freshSheets("lst-gen-001"), [
      { documentId: "FRM-TST-002", title: "Volume", currentRev: "A", approvalDate: null, approvedBy: "", location: "", status: "", revHistory: "" },
      { documentId: "SOP-NEW-1", title: "New procedure", currentRev: "Rev A", approvalDate: "2026-02-01", approvedBy: "Shawn", location: "Quality", status: "Approved", revHistory: "Added" },
    ]);
    expect(appended.added).toEqual(["SOP-NEW-1"]);
    const internal = appended.sheets[0]!;
    const ids = Object.entries(internal.cells).filter(([addr]) => /^A\d+$/.test(addr)).map(([, cell]) => cell.v);
    expect(ids).toContain("SOP-NEW-1");
    expect(ids).not.toContain("FRM-TST-002");

    const equipment = appendEquipment(freshSheets("lst-eqp-001"), [
      { assetId: "ASSET-NEW", name: "Bench scale", manufacturer: "Ohaus", serial: "S1", location: "Lab", method: "Weight", intervalMonths: 12, lastCal: "2026-03-01", status: "Active" },
    ]);
    expect(equipment.added).toEqual(["ASSET-NEW"]);
    const sheet = equipment.sheets[0]!;
    const row = Object.entries(sheet.cells).find(([, cell]) => cell.v === "ASSET-NEW")?.[0];
    expect(row).toMatch(/^A\d+$/);
    const line = Number(row?.slice(1));
    expect(sheet.cells[`I${line}`]?.f).toBe(`H${line}+(G${line}*30)`);
    expect(formulaSerial(sheet, sheet.cells[`I${line}`]?.f ?? "")).toBeGreaterThan(40000);
  });

  it("extends the due-date formula when a row is added and shifts it when a row is deleted", () => {
    const added = addDataRow("lst-eqp-001", freshSheets("lst-eqp-001"), "LST-EQP-001 - Master Equipment ");
    expect(added?.row).toBe(111);
    expect(added?.sheets[0]?.cells.I111?.f).toBe("H111+(G111*30)");
    const removed = removeDataRow("lst-eqp-001", added!.sheets, "LST-EQP-001 - Master Equipment ", 6);
    expect(removed?.[0]?.cells.I110?.f).toBe("H110+(G110*30)");
    expect(removed?.[0]?.cells.B2?.v).toBe("Rev: A");
  });

  it("writes a workbook with live formulas, merges, and the equipment colors", async () => {
    const sheets = freshSheets("lst-eqp-001");
    const body = await buildListWorkbook("lst-eqp-001", sheets);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(body);
    const ws = book.getWorksheet("LST-EQP-001 - Master Equipment ");
    expect(ws).toBeTruthy();
    expect(ws?.getCell("A1").value).toBe("MASTER EQUIPMENT LIST");
    expect(ws?.getCell("I6").value).toMatchObject({ formula: "H6+(G6*30)" });
    expect(ws?.model.merges ?? []).toEqual(expect.arrayContaining(["A1:J1", "F2:J2"]));
    expect(ws?.pageSetup.orientation).toBe("landscape");
    const lab = await buildListWorkbook("lst-gen-003", freshSheets("lst-gen-003"));
    const labBook = new ExcelJS.Workbook();
    await labBook.xlsx.load(lab);
    expect(labBook.worksheets[0]?.pageSetup.orientation).toBe("portrait");
    expect(labBook.worksheets[0]?.getCell("D2").value).toBe("A");
  });

  it("plans cleanup of Quality Manual uploads and blank copies, and leaves filled records", () => {
    const folders = [
      { id: 1, name: "ISO Compliance Documents", parentId: null },
      { id: 2, name: "Quality Manual", parentId: 1 },
      { id: 3, name: "Master Equipment List", parentId: 2, linkedPath: "/calibration/master-list" },
      { id: 4, name: "Master Equipment List.xlsx", parentId: 2, documentId: 9, pdfPath: "files/old.xlsx" },
      { id: 5, name: "Blank Form Templates", parentId: 1 },
      { id: 6, name: "Master Document List", parentId: 5 },
      { id: 7, name: "Blank Forms Templates", parentId: 1 },
      { id: 8, name: "Scope of Laboratory Activities", parentId: 7 },
      { id: 9, name: "Master Equipment List", parentId: 2, linkedPath: "/calibration/88" },
      { id: 10, name: "Torque procedure", parentId: 2, documentId: 12 },
    ];
    const plan = planListCleanup(
      folders,
      [
        { id: 9, title: "Master Equipment List" },
        { id: 12, title: "Torque procedure" },
        { id: 15, title: "Master Document List" },
      ],
      [
        { id: 1, formKey: "lst-eqp-001", formId: "LST-EQP-001", title: "Master Equipment List" },
        { id: 2, formKey: "frm-val-001", formId: "FRM-VAL-001", title: "CSA VALIDATION REPORT" },
      ],
    );
    expect(plan.documentIds).toEqual([9]);
    expect(plan.templateIds).toEqual([1]);
    expect(plan.folderNodeIds.sort((a, b) => a - b)).toEqual([4, 6, 8]);
    const again = planListCleanup(
      folders.filter((folder) => !plan.folderNodeIds.includes(folder.id)),
      [{ id: 12, title: "Torque procedure" }],
      [{ id: 2, formKey: "frm-val-001", formId: "FRM-VAL-001", title: "CSA VALIDATION REPORT" }],
    );
    expect(again).toEqual({ documentIds: [], templateIds: [], folderNodeIds: [] });
  });
});
