import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { formulaSerial, listOptions, shownCell, toneFill } from "../src/modules/controlled-lists/math.js";
import {
  LISTS,
  addDataRow,
  addListColumn,
  appendDocuments,
  appendEquipment,
  applyInputPatch,
  changeSummary,
  freshSheets,
  insertDataRow,
  insertLocationPath,
  planListCleanup,
  removeDataRow,
  removeDataRows,
  removeListColumn,
  renameListColumn,
  restoreHeaderBlock,
  revisionLetter,
  rowsDeletedSummary,
} from "../src/modules/controlled-lists/logic.js";
import { workbookFileName } from "../src/modules/controlled-lists/workbook.js";
import parity from "../src/modules/controlled-lists/seeds/formula-parity.json" with { type: "json" };
import { buildListWorkbook } from "../src/modules/controlled-lists/workbook.js";

describe("living controlled lists", () => {
  it("loads Shawn's rows and matches every Excel due-date formula", () => {
    const equipment = freshSheets("lst-eqp-001")[0]!;
    expect(equipment.cells.A1).toMatchObject({ v: "MASTER EQUIPMENT LIST", bold: true, size: 26 });
    expect(equipment.cells.B2).toMatchObject({ v: "Rev: A", kind: "rev" });
    expect(equipment.cells.D2).toMatchObject({ v: "2026-01-26", nf: "mm-dd-yy" });
    expect(equipment.cells.E2?.v).toBe("Authorized By:");
    expect(equipment.cells.F2).toMatchObject({ v: "Maxwell Tollefson", kind: "input" });
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
    expect(internal.cells.A2?.v).toBe("Document ID:");
    expect(internal.cells.B2?.v).toBe("LST-GEN-001");
    expect(internal.cells.C2?.v).toBe("Structure Rev: ");
    expect(internal.cells.D2).toMatchObject({ v: "B", kind: "rev" });
    expect(internal.cells.E2?.v).toBe("Last Updated:");
    expect(internal.cells.F2).toMatchObject({ v: "2026-01-26", nf: "d-mmm-yy" });
    expect(sheets[1]?.cells.F2?.v).toBe("Owner");
    expect(internal.cells.A4?.v).toBe("FRM-CAR-001");
    expect(Object.values(internal.cells).some((cell) => cell.v === "FRM-TST-001" || cell.v === "FRM-TST-002")).toBe(false);
    expect(Object.values(internal.cells).some((cell) => cell.v === "FRM-VAL-001")).toBe(true);
    const edited = applyInputPatch("lst-gen-001", sheets, [{ name: "Internal Documents", cells: { B4: { v: "Supplier CAR" }, D2: { v: "Z" }, A3: { v: "Record No." } } }]);
    expect(edited.sheets[0]?.cells.B4?.v).toBe("Supplier CAR");
    expect(edited.sheets[0]?.cells.D2?.v).toBe("Z");
    expect(edited.sheets[0]?.cells.A3?.v).toBe("Document ID");
    expect(edited.changes.map((change) => change.addr).sort()).toEqual(["B4", "D2"]);
    expect(changeSummary("Shawn", edited.changes)).toContain("B4 on Internal Documents");
    expect(changeSummary("Shawn", edited.changes, "Oct 8, 2026, 9:00 AM")).toContain("on Oct 8, 2026, 9:00 AM");
    expect(changeSummary("Shawn", edited.changes)).toContain('from "');
  });

  it("loads the laboratory scope and appends missing register and equipment rows", () => {
    const lab = freshSheets("lst-gen-003")[0]!;
    expect(lab.cells.A1?.v).toBe("SCOPE OF LABORATORY ACTIVITIES");
    expect(lab.cells.D2).toMatchObject({ v: "A", kind: "rev" });
    expect(lab.cells.A3?.v).toBe("Date:");
    expect(lab.cells.B3).toMatchObject({ v: "2026-07-14", nf: "mm-dd-yy", kind: "input" });
    expect(lab.cells.C3?.v).toBe("Owner:");
    expect(lab.cells.D3).toMatchObject({ v: "Maxwell Tollefson", kind: "input" });
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
    const devLog = planListCleanup(
      [
        ...folders,
        { id: 11, name: "Test Data Projects", parentId: 1 },
        { id: 12, name: "LST-DEV-001", parentId: 11, linkedPath: "/documents/development-log" },
        { id: 13, name: "Development Log.xlsx", parentId: 11, documentId: 20, pdfPath: "files/dev.xlsx" },
        { id: 14, name: "Development Log", parentId: 5 },
      ],
      [
        { id: 9, title: "Master Equipment List" },
        { id: 12, title: "Torque procedure" },
        { id: 15, title: "Master Document List" },
        { id: 20, title: "Development Log" },
      ],
      [
        { id: 1, formKey: "lst-eqp-001", formId: "LST-EQP-001", title: "Master Equipment List" },
        { id: 2, formKey: "frm-val-001", formId: "FRM-VAL-001", title: "CSA VALIDATION REPORT" },
        { id: 3, formKey: "custom-dev", formId: "LST-DEV-001", title: "Development Log (Register)" },
      ],
    );
    expect(devLog.documentIds).toEqual(expect.arrayContaining([9, 20]));
    expect(devLog.templateIds).toEqual(expect.arrayContaining([1, 3]));
    expect(devLog.folderNodeIds).toEqual(expect.arrayContaining([4, 6, 8, 13, 14]));
    expect(devLog.folderNodeIds).not.toContain(12);
    const keptBlank = planListCleanup(
      [
        { id: 1, name: "ISO Compliance Documents", parentId: null },
        { id: 5, name: "Blank Form Templates", parentId: 1 },
        { id: 30, name: "Non-Conformance Log", parentId: 5 },
      ],
      [],
      [{ id: 9, formKey: "lst-ncr-001", formId: "LST-NCR-001", title: "Non-Conformance Log" }],
    );
    expect(keptBlank).toEqual({ documentIds: [], templateIds: [], folderNodeIds: [] });
    const audit = planListCleanup(
      [
        { id: 1, name: "ISO Compliance Documents", parentId: null },
        { id: 2, name: "Management System", parentId: 1 },
        { id: 3, name: "LST-GEN-002", parentId: 2, linkedPath: "/documents/internal-audit-schedule" },
        { id: 4, name: "Internal Audit Schedule.xlsx", parentId: 2, documentId: 40, pdfPath: "files/audit.xlsx" },
        { id: 5, name: "Blank Forms Templates", parentId: 1 },
        { id: 6, name: "LST-GEN-002", parentId: 5 },
        { id: 7, name: "Audits", parentId: 1 },
        { id: 8, name: "Internal Audit Schedule", parentId: 7 },
        { id: 9, name: "Internal Audit Schedule", parentId: 2, linkedPath: "/documents/88001" },
      ],
      [{ id: 40, title: "Internal Audit Schedule" }],
      [{ id: 8, formKey: "custom-audit", formId: "LST-GEN-002", title: "Internal Audit Schedule" }],
    );
    expect(audit.documentIds).toEqual([40]);
    expect(audit.templateIds).toEqual([8]);
    expect(audit.folderNodeIds.sort((a, b) => a - b)).toEqual([4, 6]);
    const again = planListCleanup(
      folders.filter((folder) => !plan.folderNodeIds.includes(folder.id)),
      [{ id: 12, title: "Torque procedure" }],
      [{ id: 2, formKey: "frm-val-001", formId: "FRM-VAL-001", title: "CSA VALIDATION REPORT" }],
    );
    expect(again).toEqual({ documentIds: [], templateIds: [], folderNodeIds: [] });
  });

  it("keeps the development log title, location, dropdowns, and revision", async () => {
    const sheets = freshSheets("lst-dev-001");
    expect(sheets.map((sheet) => sheet.name)).toEqual(["Test Reports", "Validation Report"]);
    const reports = sheets[0]!;
    const validation = sheets[1]!;
    const location = "Location: X:\\ISO Compliance Documents\\06_Test_Data_Projects";
    expect(reports.cells.A1).toMatchObject({ v: "DEVELOPMENT LOG (REGISTER)", bold: true, size: 22, align: "center" });
    expect(reports.cells.B2).toMatchObject({ v: "Rev: B", kind: "rev" });
    expect(reports.cells.C2?.v).toBe(location);
    expect(reports.cells.E2).toMatchObject({ v: "Approved By:", align: "center" });
    expect(reports.cells.F2).toMatchObject({ v: "Maxwell Tollefson", kind: "input", align: "center" });
    expect(reports.cells.H2).toMatchObject({ v: "Date: 7/27/26", kind: "input", align: "center" });
    expect(reports.cells.A3?.v).toContain("TRP - [Year]");
    expect(reports.cells.A5?.v).toBe("TRP-2026-001");
    expect(reports.cells.B5).toMatchObject({ v: "2026-02-12", nf: "mm-dd-yy" });
    expect(reports.cells.A471?.v).toBe("TRP-2026-467");
    expect(reports.cells.C9).toMatchObject({ font: "Arial", size: 10 });
    expect(reports.merges).toEqual(expect.arrayContaining(["A1:H1", "A3:H3", "C2:D2", "F2:G2"]));
    expect(validation.cells.A1?.v).toBe("DEVELOPMENT LOG (REGISTER)");
    expect(validation.cells.B2?.v).toBe("Rev: B");
    expect(validation.cells.C2?.v).toBe(location);
    expect(validation.cells.E2?.v).toBe("Approved By:");
    expect(validation.cells.F2).toMatchObject({ v: "Maxwell Tollefson", kind: "input" });
    expect(validation.cells.H2).toMatchObject({ v: "Date: 7/27/26", kind: "input" });
    expect(validation.colWidths[7]).toBeCloseTo(12.7109375, 5);
    expect(validation.cells.A3?.v).toContain("VAL - [Year]");
    expect(validation.cells.A5?.v).toBe("VAL-2026-001");
    expect(validation.cells.A1989?.v).toBe("VAL-2026-2000");
    expect(validation.merges).toEqual(expect.arrayContaining(["A1:I1", "A3:I3", "C2:D2", "F2:G2", "H2:I2"]));
    expect(listOptions(reports, "F5")).toEqual(["Development Document", "Salt Spray", "Final Test Report"]);
    expect(listOptions(reports, "G8")).toContain("SENSEN");
    expect(listOptions(validation, "H5")).toEqual(["Active", "Cancelled"]);
    expect(listOptions(validation, "F5")).toContain("Benchmark Analysis");
    expect(workbookFileName("lst-dev-001")).toBe("LST-DEV-001.xlsx");

    const edited = applyInputPatch("lst-dev-001", sheets, [
      { name: "Test Reports", cells: { C5: { v: "FCS Shock" }, B2: { v: "Rev: Z" }, C2: { v: "somewhere else" }, F2: { v: "Shawn Parnell" }, H2: { v: "Date: 8/1/26" } } },
    ]);
    expect(edited.sheets[0]?.cells.C5?.v).toBe("FCS Shock");
    expect(edited.sheets[0]?.cells.B2?.v).toBe("Rev: Z");
    expect(edited.sheets[0]?.cells.C2?.v).toBe("somewhere else");
    expect(edited.sheets[0]?.cells.F2?.v).toBe("Shawn Parnell");
    expect(edited.sheets[0]?.cells.H2?.v).toBe("Date: 8/1/26");
    expect(edited.sheets[0]?.cells.F2?.kind).toBe("input");
    expect(edited.sheets[1]?.cells.B2?.v).toBe("Rev: B");
    expect(edited.sheets[1]?.cells.F2?.v).toBe("Maxwell Tollefson");
    expect(LISTS["lst-dev-001"].revision).toBe("B");
    expect(edited.changes.map((change) => change.addr).sort()).toEqual(["B2", "C2", "C5", "F2", "H2"]);

    const added = addDataRow("lst-dev-001", sheets, "Test Reports");
    expect(added?.row).toBe(472);
    expect(listOptions(added!.sheets[0]!, "F472")).toContain("Calibration Document");
    expect(listOptions(added!.sheets[0]!, "F457")).toEqual(["Development Document", "Salt Spray", "Final Test Report", "Calibration Document"]);

    const body = await buildListWorkbook("lst-dev-001", sheets);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(body);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["Test Reports", "Validation Report"]);
    const ws = book.getWorksheet("Test Reports");
    expect(ws?.getCell("A1").value).toBe("DEVELOPMENT LOG (REGISTER)");
    expect(ws?.getCell("C2").value).toBe(location);
    expect(ws?.getCell("E2").value).toBe("Approved By:");
    expect(ws?.getCell("F2").value).toBe("Maxwell Tollefson");
    expect(ws?.getCell("H2").value).toBe("Date: 7/27/26");
    expect(ws?.getCell("A1").alignment?.horizontal).toBe("center");
    expect(ws?.getCell("B5").value).toBeInstanceOf(Date);
    expect((ws?.getCell("B5").value as Date).toISOString().slice(0, 10)).toBe("2026-02-12");
    expect(ws?.getCell("B5").numFmt).toBe("mm-dd-yy");
    expect(ws?.getColumn(1).width).toBeCloseTo(41.85, 1);
    expect(ws?.pageSetup.orientation).toBe("landscape");
    expect(ws?.model.merges ?? []).toEqual(expect.arrayContaining(["A1:H1"]));
    const validationSheet = book.getWorksheet("Validation Report");
    expect(validationSheet?.getCell("A1989").value).toBe("VAL-2026-2000");
    expect(validationSheet?.getCell("A1").border?.top?.style).toBe("medium");
    const dropdown = ws?.dataValidations.model["F5:F284"] ?? ws?.dataValidations.model.F5;
    const formula = JSON.stringify(dropdown ?? ws?.dataValidations.model);
    expect(formula).toContain("Salt Spray");
  });

  it("keeps each nonconformance tab's own Rev and records the document as Rev G", async () => {
    const sheets = freshSheets("lst-ncr-001");
    expect(sheets.map((sheet) => sheet.name)).toEqual(["LST-NCR-001 - NCR", "LST-NCR-001 - QTN", "LST-NCR-001 - CAR", "LST-NCR-001 - RPN"]);
    const ncr = sheets[0]!;
    const qtn = sheets[1]!;
    const car = sheets[2]!;
    const rpn = sheets[3]!;
    expect(LISTS["lst-ncr-001"].revision).toBe("G");
    expect(workbookFileName("lst-ncr-001")).toBe("LST-NCR-001.xlsx");
    expect(ncr.cells.A1).toMatchObject({ v: "NON-CONFORMANCE LOG (REGISTER)", align: "center" });
    expect(ncr.cells.B2).toMatchObject({ v: "Rev: E", kind: "rev" });
    expect(ncr.cells.C2?.v).toBe("Location: X:\\ISO Compliance Documents\\07_Quality_Logs");
    expect(ncr.cells.D2).toMatchObject({ v: "Approved By:", kind: "label" });
    expect(ncr.cells.E2).toMatchObject({ v: "Maxwell Tollefson", kind: "input" });
    expect(ncr.cells.F2?.v).toBe("Date:");
    expect(ncr.cells.G2).toMatchObject({ v: "2026-07-14", nf: "mm-dd-yy", kind: "input" });
    expect(ncr.merges).toEqual(expect.arrayContaining(["A1:K1", "G2:K2", "A3:K3"]));
    expect(ncr.cells.A5?.v).toBe("NCR-2026-001");
    expect(ncr.cells.A70?.v).toBe("NCR-2026-066");
    expect(ncr.cells.K5?.v).toBe("Closed");
    expect(shownCell(ncr, "G5").text).toBe("$0.00");
    expect(toneFill(ncr, "K5", "Closed")).toBe("FFB8DCAB");
    expect(qtn.cells.B2?.v).toBe("Rev: F");
    expect(qtn.cells.C2?.v).toBe("Location: X:\\ISO Compliance Documents\\07_Non_Conformance_Records");
    expect(qtn.cells.E2).toMatchObject({ v: "Maxwell Tollefson", kind: "input" });
    expect(qtn.cells.G2).toMatchObject({ v: "2026-06-30", nf: "mm-dd-yy", kind: "input" });
    expect(qtn.merges).toContain("G2:L2");
    expect(qtn.cells.A5).toBeUndefined();
    expect(car.cells.B2?.v).toBe("Rev: E");
    expect(car.cells.G2).toMatchObject({ v: "2026-06-15", kind: "input" });
    expect(car.colWidths[6]).toBeCloseTo(9.140625, 5);
    expect(car.merges).toContain("G2:H2");
    expect(car.cells.A46?.v).toBe("CAR-2026-043");
    expect(car.cells.H5?.v).toBe("Open");
    expect(toneFill(car, "H5", "Open")).toBe("FFFF0000");
    expect(rpn.cells.B2?.v).toBe("Rev: E");
    expect(rpn.cells.E2?.v).toBe("Maxwell Tollefson");
    expect(rpn.cells.G2).toMatchObject({ v: "2026-06-15", kind: "input" });
    expect(rpn.merges).toContain("G2:H2");
    expect(rpn.cells.A5?.v).toBe("WIN-RPN-001");
    expect(rpn.cells.A6?.v).toBe("WIN-RPN-004");
    expect(listOptions(ncr, "F5")).toEqual(["Use-As-Is", " Scrap", " Rework"]);

    const edited = applyInputPatch("lst-ncr-001", sheets, [
      { name: "LST-NCR-001 - NCR", cells: { K5: { v: "Open" }, B2: { v: "Rev: G" }, C2: { v: "moved" }, E2: { v: "Shawn Parnell" }, G2: { v: "2026-08-01" }, A4: { v: "Record Number" } } },
    ]);
    expect(edited.sheets[0]?.cells.K5?.v).toBe("Open");
    expect(edited.sheets[0]?.cells.B2?.v).toBe("Rev: G");
    expect(edited.sheets[0]?.cells.C2?.v).toBe("moved");
    expect(edited.sheets[0]?.cells.E2?.v).toBe("Shawn Parnell");
    expect(edited.sheets[0]?.cells.G2?.v).toBe("2026-08-01");
    expect(edited.sheets[0]?.cells.A4?.v).toBe("NCR Number");
    expect(edited.sheets[1]?.cells.B2?.v).toBe("Rev: F");
    expect(edited.sheets[1]?.cells.E2?.v).toBe("Maxwell Tollefson");
    expect(LISTS["lst-ncr-001"].revision).toBe("G");
    expect(edited.changes.map((change) => change.addr).sort()).toEqual(["B2", "C2", "E2", "G2", "K5"]);

    const body = await buildListWorkbook("lst-ncr-001", sheets);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(body);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["LST-NCR-001 - NCR", "LST-NCR-001 - QTN", "LST-NCR-001 - CAR", "LST-NCR-001 - RPN"]);
    const ws = book.getWorksheet("LST-NCR-001 - NCR");
    expect(ws?.getCell("B2").value).toBe("Rev: E");
    expect(ws?.getCell("A1").value).toBe("NON-CONFORMANCE LOG (REGISTER)");
    expect(ws?.getCell("D2").value).toBe("Approved By:");
    expect(ws?.getCell("E2").value).toBe("Maxwell Tollefson");
    expect(ws?.getCell("F2").value).toBe("Date:");
    expect(ws?.getCell("G2").value).toBeInstanceOf(Date);
    expect((ws?.getCell("G2").value as Date).toISOString().slice(0, 10)).toBe("2026-07-14");
    expect(ws?.model.merges ?? []).toEqual(expect.arrayContaining(["A1:K1", "G2:K2", "A3:K3"]));
    expect(ws?.pageSetup.orientation).toBe("landscape");
    expect(JSON.stringify(ws?.conditionalFormattings ?? ws?.model?.conditionalFormattings ?? [])).toContain("Open");
    expect(ws?.pageSetup.printTitlesRow).toBeUndefined();
  });

  it("restores a missing Approved By block without wiping an edited name or data rows", () => {
    const sheets = freshSheets("lst-ncr-001");
    const stripped = sheets.map((sheet) => {
      if (sheet.name !== "LST-NCR-001 - NCR") return sheet;
      const cells = { ...sheet.cells };
      delete cells.D2;
      delete cells.E2;
      delete cells.F2;
      delete cells.G2;
      return { ...sheet, cells, merges: sheet.merges.filter((merge) => merge !== "G2:K2") };
    });
    const restored = restoreHeaderBlock("lst-ncr-001", stripped);
    expect(restored.changed).toBe(true);
    expect(restored.sheets[0]?.cells.D2?.v).toBe("Approved By:");
    expect(restored.sheets[0]?.cells.E2).toMatchObject({ v: "Maxwell Tollefson", kind: "input" });
    expect(restored.sheets[0]?.cells.F2?.v).toBe("Date:");
    expect(restored.sheets[0]?.cells.G2).toMatchObject({ v: "2026-07-14", kind: "input" });
    expect(restored.sheets[0]?.merges).toContain("G2:K2");
    expect(restored.sheets[0]?.cells.A5?.v).toBe("NCR-2026-001");
    expect(restored.sheets[0]?.cells.B2?.v).toBe("Rev: E");
    expect(LISTS["lst-ncr-001"].revision).toBe("G");

    const named = restored.sheets.map((sheet) => {
      if (sheet.name !== "LST-NCR-001 - NCR") return sheet;
      return { ...sheet, cells: { ...sheet.cells, E2: { ...sheet.cells.E2!, v: "Ada Lovelace" }, G2: { ...sheet.cells.G2!, v: "2026-09-01" } } };
    });
    const kept = restoreHeaderBlock("lst-ncr-001", named);
    expect(kept.sheets[0]?.cells.E2?.v).toBe("Ada Lovelace");
    expect(kept.sheets[0]?.cells.G2?.v).toBe("2026-09-01");
    expect(kept.sheets[0]?.cells.D2?.v).toBe("Approved By:");
    const again = restoreHeaderBlock("lst-ncr-001", kept.sheets);
    expect(again.changed).toBe(false);
    expect(again.sheets).toBe(kept.sheets);
    expect(restoreHeaderBlock("lst-ncr-001", freshSheets("lst-ncr-001")).changed).toBe(false);
    expect(restoreHeaderBlock("lst-dev-001", freshSheets("lst-dev-001")).changed).toBe(false);
    expect(restoreHeaderBlock("lst-eqp-001", freshSheets("lst-eqp-001")).changed).toBe(false);
    expect(restoreHeaderBlock("lst-gen-001", freshSheets("lst-gen-001")).changed).toBe(false);
    expect(restoreHeaderBlock("lst-gen-002", freshSheets("lst-gen-002")).changed).toBe(false);
    expect(restoreHeaderBlock("lst-gen-003", freshSheets("lst-gen-003")).changed).toBe(false);
  });

  it("keeps the internal audit schedule header, rows, and Rev A", async () => {
    const sheetName = "LST-GEN-002 - Internal Audit Sc";
    const sheets = freshSheets("lst-gen-002");
    expect(sheets.map((sheet) => sheet.name)).toEqual([sheetName]);
    const sheet = sheets[0]!;
    expect(LISTS["lst-gen-002"].revision).toBe("A");
    expect(LISTS["lst-gen-002"].folder).toBe("Management System");
    expect(LISTS["lst-gen-002"].nodeName).toBe("LST-GEN-002");
    expect(workbookFileName("lst-gen-002")).toBe("LST-GEN-002.xlsx");
    expect(sheet.maxRow).toBe(36);
    expect(sheet.maxCol).toBe(8);
    expect(sheet.cells.A1).toMatchObject({ v: "INTERNAL AUDIT SCHEDULE", bold: true, size: 26, align: "center", kind: "label" });
    expect(sheet.cells.A2?.v).toBe("Doc ID:");
    expect(sheet.cells.B2).toMatchObject({ v: "LST-GEN-002", kind: "label" });
    expect(sheet.cells.C2?.v).toBe("Rev:");
    expect(sheet.cells.D2).toMatchObject({ v: "A", kind: "rev" });
    expect(sheet.cells.E2?.v).toBe("Title:");
    expect(sheet.cells.F2).toMatchObject({ v: "Internal Audit Schedule", kind: "label", align: "left" });
    expect(sheet.cells.A3?.v).toBe("Date:");
    expect(sheet.cells.B3).toMatchObject({ v: "2026-07-14", nf: "mm-dd-yy", kind: "input" });
    expect(sheet.cells.E3?.v).toBe("Owner:");
    expect(sheet.cells.F3).toMatchObject({ v: "Ron Wertz & Maxwell Tollefson", kind: "input" });
    expect(sheet.merges).toEqual(["A1:H1", "F2:H2", "B3:D3", "F3:H3", "A4:H4"]);
    expect(sheet.colWidths[0]).toBeCloseTo(11.7109375, 5);
    expect(sheet.colWidths[7]).toBeCloseTo(66.7109375, 5);
    expect(sheet.rowHeights["1"]).toBe(34.5);
    expect(sheet.boxes?.A1).toBe("mtmt");
    expect(sheet.boxes?.H1).toBe("tmmt");
    expect(sheet.cells.A5?.v).toBe("Audit Period");
    expect(sheet.cells.H5?.v).toBe("Brief Description of Findings");
    expect(sheet.cells.A6?.v).toBe("H1 - 2027");
    expect(sheet.cells.B7?.v).toBe("Quality Department");
    expect(sheet.cells.C8?.v).toBe("Design / Dev (8.3) / Change Mgmt");
    expect(sheet.cells.E9?.v).toBe("Scheduled");
    expect(sheet.cells.A10).toBeUndefined();
    expect(sheet.cells.A36).toBeUndefined();
    expect(Object.values(sheet.cells).some((cell) => cell.f)).toBe(false);
    expect(sheet.lists ?? []).toEqual([]);
    expect(listOptions(sheet, "E6")).toBeNull();

    const edited = applyInputPatch("lst-gen-002", sheets, [
      { name: sheetName, cells: { E6: { v: "Complete" }, D2: { v: "B" }, A1: { v: "CHANGED" }, F3: { v: "Shawn Parnell" }, B3: { v: "2026-08-01" }, A5: { v: "Period" } } },
    ]);
    expect(edited.sheets[0]?.cells.E6?.v).toBe("Complete");
    expect(edited.sheets[0]?.cells.F3?.v).toBe("Shawn Parnell");
    expect(edited.sheets[0]?.cells.B3?.v).toBe("2026-08-01");
    expect(edited.sheets[0]?.cells.D2?.v).toBe("B");
    expect(edited.sheets[0]?.cells.A1?.v).toBe("CHANGED");
    expect(edited.sheets[0]?.cells.A5?.v).toBe("Audit Period");
    expect(edited.sheets[0]?.cells.A6?.v).toBe("H1 - 2027");
    expect(LISTS["lst-gen-002"].revision).toBe("A");
    expect(edited.changes.map((change) => change.addr).sort()).toEqual(["A1", "B3", "D2", "E6", "F3"]);

    const added = addDataRow("lst-gen-002", sheets, sheetName);
    expect(added?.row).toBe(10);
    expect(added?.sheets[0]?.cells.A10).toBeUndefined();
    expect(added?.sheets[0]?.maxRow).toBe(36);
    const removed = removeDataRow("lst-gen-002", sheets, sheetName, 6);
    expect(removed?.[0]?.cells.B6?.v).toBe("Quality Department");
    expect(removed?.[0]?.cells.D2?.v).toBe("A");
    expect(removed?.[0]?.maxRow).toBe(35);

    const stripped = sheets.map((item) => {
      const next = { ...item, cells: { ...item.cells }, merges: item.merges.filter((merge) => merge !== "F3:H3") };
      delete next.cells.F3;
      delete next.cells.B3;
      return next;
    });
    const restored = restoreHeaderBlock("lst-gen-002", stripped);
    expect(restored.changed).toBe(true);
    expect(restored.sheets[0]?.cells.F3).toMatchObject({ v: "Ron Wertz & Maxwell Tollefson", kind: "input" });
    expect(restored.sheets[0]?.cells.B3).toMatchObject({ v: "2026-07-14", kind: "input" });
    expect(restored.sheets[0]?.merges).toContain("F3:H3");
    expect(restored.sheets[0]?.cells.A6?.v).toBe("H1 - 2027");
    const named = restored.sheets.map((item) => ({
      ...item,
      cells: { ...item.cells, F3: { ...item.cells.F3!, v: "Ada Lovelace" }, B3: { ...item.cells.B3!, v: "2026-09-01" } },
    }));
    const kept = restoreHeaderBlock("lst-gen-002", named);
    expect(kept.sheets[0]?.cells.F3?.v).toBe("Ada Lovelace");
    expect(kept.sheets[0]?.cells.B3?.v).toBe("2026-09-01");
    expect(kept.sheets[0]?.cells.D2?.v).toBe("A");

    const body = await buildListWorkbook("lst-gen-002", sheets);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(body);
    expect(book.worksheets.map((item) => item.name)).toEqual([sheetName]);
    const ws = book.getWorksheet(sheetName);
    expect(ws?.getCell("A1").value).toBe("INTERNAL AUDIT SCHEDULE");
    expect(ws?.getCell("A1").font?.bold).toBe(true);
    expect(ws?.getCell("A1").font?.size).toBe(26);
    expect(ws?.getCell("A1").alignment?.horizontal).toBe("center");
    expect(ws?.getCell("D2").value).toBe("A");
    expect(ws?.getCell("F2").value).toBe("Internal Audit Schedule");
    expect(ws?.getCell("B3").value).toBeInstanceOf(Date);
    expect((ws?.getCell("B3").value as Date).toISOString().slice(0, 10)).toBe("2026-07-14");
    expect(ws?.getCell("B3").numFmt).toBe("mm-dd-yy");
    expect(ws?.getCell("F3").value).toBe("Ron Wertz & Maxwell Tollefson");
    expect(ws?.getCell("A6").value).toBe("H1 - 2027");
    expect(ws?.getCell("E9").value).toBe("Scheduled");
    expect(ws?.getCell("H5").value).toBe("Brief Description of Findings");
    expect(ws?.getColumn(8).width).toBeCloseTo(66.7109375, 5);
    expect(ws?.getRow(1).height).toBe(34.5);
    expect(ws?.model.merges ?? []).toEqual(expect.arrayContaining(["A1:H1", "F2:H2", "B3:D3", "F3:H3", "A4:H4"]));
    expect(ws?.getCell("A1").border?.top?.style).toBe("medium");
    expect(ws?.getCell("A1").border?.left?.style).toBe("medium");
    expect(ws?.pageSetup.orientation).toBe("portrait");
    expect(Object.keys(ws?.dataValidations.model ?? {})).toEqual([]);
    expect(ws?.getCell("A6").value).not.toMatch(/^=/);
  });

  it("inserts the current folder path into a Location cell only when asked, and keeps it", () => {
    const path = "ISO Compliance Documents\\Quality Logs\\LST-NCR-001";
    const sheets = freshSheets("lst-ncr-001");
    expect(sheets[0]?.cells.C2?.v).toBe("Location: X:\\ISO Compliance Documents\\07_Quality_Logs");
    const typed = applyInputPatch("lst-ncr-001", sheets, [{ name: "LST-NCR-001 - NCR", cells: { C2: { v: `Location: ${path}` } } }]);
    expect(typed.sheets[0]?.cells.C2?.v).toBe(`Location: ${path}`);
    expect(typed.changes.map((change) => change.addr)).toEqual(["C2"]);

    const inserted = insertLocationPath("lst-ncr-001", sheets, "LST-NCR-001 - NCR", path);
    expect(inserted.changes.map((change) => change.addr)).toEqual(["C2"]);
    expect(inserted.sheets[0]?.cells.C2).toMatchObject({ v: `Location: ${path}`, kind: "location" });
    expect(inserted.sheets[1]?.cells.C2?.v).toBe("Location: X:\\ISO Compliance Documents\\07_Non_Conformance_Records");
    const again = insertLocationPath("lst-ncr-001", inserted.sheets, "LST-NCR-001 - NCR", path);
    expect(again.changes).toEqual([]);
    expect(again.sheets).toBe(inserted.sheets);

    const restored = restoreHeaderBlock("lst-ncr-001", inserted.sheets);
    expect(restored.sheets[0]?.cells.C2).toMatchObject({ v: `Location: ${path}`, kind: "location" });
    expect(restored.sheets[0]?.cells.B2?.v).toBe("Rev: E");
    const patched = applyInputPatch("lst-ncr-001", restored.sheets, [{ name: "LST-NCR-001 - NCR", cells: { C2: { v: "somewhere else" } } }]);
    expect(patched.sheets[0]?.cells.C2?.v).toBe("somewhere else");

    const devPath = "ISO Compliance Documents\\Test Data Projects\\LST-DEV-001";
    const dev = insertLocationPath("lst-dev-001", freshSheets("lst-dev-001"), "Test Reports", devPath);
    expect(dev.sheets[0]?.cells.C2?.v).toBe(`Location: ${devPath}`);
    expect(dev.sheets[1]?.cells.C2?.v).toBe("Location: X:\\ISO Compliance Documents\\06_Test_Data_Projects");
  });

  it("keeps the engineering request change log as Rev A and does not number new rows", async () => {
    const sheetName = "LST-ENG-001 - ECR Tracker - Rev";
    const location = "Location: X:\\ISO Compliance Documents\\12_Engineering_Logs";
    const sheets = freshSheets("lst-eng-001");
    expect(sheets.map((sheet) => sheet.name)).toEqual([sheetName]);
    expect(LISTS["lst-eng-001"].revision).toBe("A");
    expect(LISTS["lst-eng-001"].folder).toBe("Engineering Logs");
    expect(workbookFileName("lst-eng-001")).toBe("LST-ENG-001.xlsx");
    const sheet = sheets[0]!;
    expect(sheet.maxCol).toBe(11);
    expect(sheet.maxRow).toBe(55);
    expect(sheet.cells.A1).toMatchObject({ v: "ENGINEERING REQUEST CHANGE LOG", bold: true, size: 26, align: "center" });
    expect(sheet.cells.B2?.v).toBe("LST-ENG-001");
    expect(sheet.cells.D2).toMatchObject({ v: "A", kind: "rev" });
    expect(sheet.cells.E2?.v).toBe(location);
    expect(sheet.cells.H2).toMatchObject({ v: "Maxwell Tollefson", kind: "input" });
    expect(sheet.cells.K2).toMatchObject({ v: "2026-07-02", nf: "mm-dd-yy", kind: "input" });
    expect(sheet.cells.A3?.v).toBe("STATUS KEY: Open (Red), Closed (Green)");
    expect(sheet.cells.E3?.v).toContain("Save Document as ECR-YEAR-XXX");
    expect(sheet.cells.A5?.v).toBe("ECR Number");
    expect(sheet.cells.K5?.v).toBe("Closed / Verified By");
    expect(sheet.merges).toEqual(expect.arrayContaining(["A1:K1", "E2:F2", "H2:I2", "A3:D3", "E3:K3", "A4:K4"]));
    expect(sheet.colWidths[0]).toBeCloseTo(16.5703125, 5);
    expect(sheet.colWidths[5]).toBeCloseTo(40.28515625, 5);
    expect(sheet.cells.A6?.v).toBe("ECR-2026-001");
    expect(sheet.cells.B6).toMatchObject({ v: "2026-07-02", nf: "mm-dd-yy" });
    expect(sheet.cells.G6?.v).toBe(0);
    expect(sheet.cells.I6?.v).toBe("Pending");
    expect(sheet.cells.A55?.v).toBe("ECR-2026-050");
    expect(sheet.cells.I9).toMatchObject({ v: "Closed", font: "Arial" });
    expect(toneFill(sheet, "I6", "Pending")).toBe("FFFFFF00");
    expect(toneFill(sheet, "I7", "Approved")).toBe("FF00B050");
    expect(toneFill(sheet, "I8", "Rejected")).toBe("FFFF0000");
    expect(toneFill(sheet, "I9", "Closed")).toBeNull();
    expect(listOptions(sheet, "E6")).toEqual(["APM", "SENSEN", "Linyi", "XJ", "ADD", "Jinbo", "JH", "GACI", "Aborn", "Taizan", "Zoran"]);
    expect(listOptions(sheet, "H6")).toEqual(["Yes", "No"]);
    expect(listOptions(sheet, "I6")).toEqual(["Pending", "Approved", "Rejected"]);
    expect(listOptions(sheet, "I9")).toEqual(["Pending", "Approved", "Rejected", "Closed"]);
    expect(shownCell(sheet, "G6").text).toBe("0");

    const edited = applyInputPatch("lst-eng-001", sheets, [
      { name: sheetName, cells: { A6: { v: "ECR-2026-099" }, D2: { v: "B" }, E2: { v: "moved" }, H2: { v: "Shawn Parnell" }, K2: { v: "2026-08-01" } } },
    ]);
    expect(edited.sheets[0]?.cells.A6?.v).toBe("ECR-2026-099");
    expect(edited.sheets[0]?.cells.D2?.v).toBe("B");
    expect(edited.sheets[0]?.cells.E2?.v).toBe("moved");
    expect(edited.sheets[0]?.cells.H2?.v).toBe("Shawn Parnell");
    expect(edited.sheets[0]?.cells.K2?.v).toBe("2026-08-01");
    expect(edited.sheets[0]?.cells.I6?.f).toBeUndefined();
    expect(LISTS["lst-eng-001"].revision).toBe("A");
    expect(edited.changes.map((change) => change.addr).sort()).toEqual(["A6", "D2", "E2", "H2", "K2"]);

    const added = addDataRow("lst-eng-001", sheets, sheetName);
    expect(added?.row).toBe(56);
    expect(added?.sheets[0]?.cells.A56).toBeUndefined();
    expect(listOptions(added!.sheets[0]!, "E56")).toContain("SENSEN");
    expect(listOptions(added!.sheets[0]!, "I56")).toEqual(["Pending", "Approved", "Rejected"]);

    const removed = removeDataRow("lst-eng-001", sheets, sheetName, 6);
    expect(removed?.[0]?.cells.A6?.v).toBe("ECR-2026-002");
    expect(removed?.[0]?.cells.A54?.v).toBe("ECR-2026-050");

    expect(restoreHeaderBlock("lst-eng-001", freshSheets("lst-eng-001")).changed).toBe(false);
    const path = "ISO Compliance Documents\\Engineering Logs\\LST-ENG-001";
    const inserted = insertLocationPath("lst-eng-001", sheets, sheetName, path);
    expect(inserted.sheets[0]?.cells.E2).toMatchObject({ v: `Location: ${path}`, kind: "location" });
    const kept = restoreHeaderBlock("lst-eng-001", inserted.sheets);
    expect(kept.sheets[0]?.cells.E2?.v).toBe(`Location: ${path}`);
    expect(kept.sheets[0]?.cells.D2?.v).toBe("A");

    const cleaned = planListCleanup(
      [
        { id: 1, name: "ISO Compliance Documents", parentId: null },
        { id: 2, name: "Engineering Logs", parentId: 1 },
        { id: 3, name: "LST-ENG-001", parentId: 2, linkedPath: "/documents/engineering-request-log" },
        { id: 4, name: "ENGINEERING REQUEST CHANGE LOG.xlsx", parentId: 2, documentId: 40, pdfPath: "files/ecr.xlsx" },
        { id: 5, name: "Blank Forms Templates", parentId: 1 },
        { id: 6, name: "ECR Tracker", parentId: 5 },
        { id: 7, name: "Engineering Change Request", parentId: 5 },
      ],
      [
        { id: 40, title: "ENGINEERING REQUEST CHANGE LOG" },
        { id: 41, title: "Engineering Change Request" },
      ],
      [
        { id: 8, formKey: "lst-eng-001", formId: "LST-ENG-001", title: "ECR Tracker" },
        { id: 9, formKey: "ecr", formId: "", title: "Engineering Change Request" },
      ],
    );
    expect(cleaned.documentIds).toEqual([40]);
    expect(cleaned.templateIds).toEqual([8]);
    expect(cleaned.folderNodeIds).toEqual(expect.arrayContaining([4, 6]));
    expect(cleaned.folderNodeIds).not.toContain(3);
    expect(cleaned.folderNodeIds).not.toContain(7);
    const again = planListCleanup(
      [
        { id: 1, name: "ISO Compliance Documents", parentId: null },
        { id: 2, name: "Engineering Logs", parentId: 1 },
        { id: 3, name: "LST-ENG-001", parentId: 2, linkedPath: "/documents/engineering-request-log" },
      ],
      [],
      [{ id: 9, formKey: "ecr", formId: "", title: "Engineering Change Request" }],
    );
    expect(again).toEqual({ documentIds: [], templateIds: [], folderNodeIds: [] });

    const body = await buildListWorkbook("lst-eng-001", sheets);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(body);
    expect(book.worksheets.map((item) => item.name)).toEqual([sheetName]);
    const ws = book.getWorksheet(sheetName);
    expect(ws?.getCell("A1").value).toBe("ENGINEERING REQUEST CHANGE LOG");
    expect(ws?.getCell("A1").font?.bold).toBe(true);
    expect(ws?.getCell("A1").font?.size).toBe(26);
    expect(ws?.getCell("D2").value).toBe("A");
    expect(ws?.getCell("E2").value).toBe(location);
    expect(ws?.getCell("H2").value).toBe("Maxwell Tollefson");
    expect(ws?.getCell("K2").value).toBeInstanceOf(Date);
    expect((ws?.getCell("K2").value as Date).toISOString().slice(0, 10)).toBe("2026-07-02");
    expect(ws?.getCell("K2").numFmt).toBe("mm-dd-yy");
    expect(ws?.getCell("B6").numFmt).toBe("mm-dd-yy");
    expect((ws?.getCell("B6").value as Date).toISOString().slice(0, 10)).toBe("2026-07-02");
    expect(ws?.getCell("G6").value).toBe(0);
    expect(ws?.getCell("A55").value).toBe("ECR-2026-050");
    expect(ws?.getCell("I9").font?.name).toBe("Arial");
    expect(ws?.getColumn(1).width).toBeCloseTo(16.57, 1);
    expect(ws?.getColumn(6).width).toBeCloseTo(40.29, 1);
    expect(ws?.pageSetup.orientation).toBe("landscape");
    expect(ws?.model.merges ?? []).toEqual(expect.arrayContaining(["A1:K1", "A3:D3", "E3:K3", "A4:K4"]));
    expect(ws?.getCell("A1").border?.left?.style).toBe("thin");
    expect(ws?.getCell("A1").border?.right?.style).toBeUndefined();
    const rules = JSON.stringify(ws?.conditionalFormattings ?? []);
    expect(rules).toContain("Pending");
    expect(rules).toContain("Approved");
    expect(rules).toContain("Rejected");
    expect(rules).toContain("FFFFFF00");
    expect(rules).toContain("FF00B050");
    expect(rules).toContain("FFFF0000");
    const validations = JSON.stringify(ws?.dataValidations.model ?? {});
    expect(validations).toContain("SENSEN");
    expect(validations).toContain("Pending");
    expect(validations).toContain("Yes");
    expect(validations).toContain("Closed");
  });

  it("edits seeded rows, inserts and deletes without numbering, and bumps revision only for columns", () => {
    const engName = "LST-ENG-001 - ECR Tracker - Rev";
    const eng = freshSheets("lst-eng-001");
    expect(eng[0]?.cells.H2?.v).toBe("Maxwell Tollefson");
    expect(eng[0]?.cells.K2?.v).toBe("2026-07-02");
    expect(eng[0]?.cells.B2?.v).toBe("LST-ENG-001");
    const gen2 = freshSheets("lst-gen-002")[0]!;
    expect(gen2.cells.F3?.v).toBe("Ron Wertz & Maxwell Tollefson");
    expect(gen2.cells.B3?.v).toBe("2026-07-14");
    expect(gen2.cells.F2?.v).toBe("Internal Audit Schedule");
    const ncr = freshSheets("lst-ncr-001")[0]!;
    expect(ncr.cells.E2?.v).toBe("Maxwell Tollefson");
    expect(ncr.cells.D2?.v).toBe("Approved By:");
    expect(ncr.cells.G2?.v).toBe("2026-07-14");
    expect(revisionLetter("Rev: E")).toBe("E");
    expect(revisionLetter("A")).toBe("A");
    expect(revisionLetter("Maxwell Tollefson")).toBeNull();

    const inserted = insertDataRow("lst-eng-001", eng, engName, 6);
    expect(inserted?.row).toBe(6);
    expect(inserted?.sheets[0]?.cells.A6).toBeUndefined();
    expect(inserted?.sheets[0]?.cells.A7?.v).toBe("ECR-2026-001");
    expect(Object.values(inserted?.sheets[0]?.cells ?? {}).some((cell) => cell.v === "ECR-2026-051")).toBe(false);
    expect(listOptions(inserted!.sheets[0]!, "E6")).toContain("SENSEN");

    const below = insertDataRow("lst-eng-001", eng, engName, 7);
    expect(below?.sheets[0]?.cells.A6?.v).toBe("ECR-2026-001");
    expect(below?.sheets[0]?.cells.A7).toBeUndefined();
    expect(below?.sheets[0]?.cells.A8?.v).toBe("ECR-2026-002");

    const removed = removeDataRows("lst-eng-001", eng, engName, [6, 8]);
    expect(removed?.[0]?.cells.A6?.v).toBe("ECR-2026-002");
    expect(removed?.[0]?.cells.A7?.v).toBe("ECR-2026-004");
    expect(rowsDeletedSummary("Shawn", engName, [{ row: 6, label: "ECR-2026-001", values: 'A6 "ECR-2026-001"' }], "Oct 8, 2026")).toContain("ECR-2026-001");
    expect(rowsDeletedSummary("Shawn", engName, [{ row: 6, label: "ECR-2026-001" }], "Oct 8, 2026")).toContain("on Oct 8, 2026");

    const equipmentName = "LST-EQP-001 - Master Equipment ";
    const equipment = freshSheets("lst-eqp-001");
    const shifted = insertDataRow("lst-eqp-001", equipment, equipmentName, 6);
    expect(shifted?.sheets[0]?.cells.I6?.f).toBe("H6+(G6*30)");
    expect(shifted?.sheets[0]?.cells.I7?.f).toBe("H7+(G7*30)");
    expect(shifted?.sheets[0]?.cells.A6).toBeUndefined();
    const patched = applyInputPatch("lst-eqp-001", equipment, [{ name: equipmentName, cells: { G6: { v: 99 }, I6: { v: 99 } } }]);
    expect(patched.sheets[0]?.cells.I6?.f).toBe("H6+(G6*30)");
    expect(patched.sheets[0]?.cells.G6?.v).toBe(99);
    expect(formulaSerial(patched.sheets[0]!, patched.sheets[0]?.cells.I6?.f ?? "")).not.toBe(formulaSerial(equipment[0]!, equipment[0]?.cells.I6?.f ?? ""));

    const renamed = renameListColumn("lst-eng-001", eng, "A", engName, "A", "Request");
    expect(renamed?.bumped).toBe(true);
    expect(renamed?.revision).toBe("B");
    expect(renamed?.sheets[0]?.cells.A5?.v).toBe("Request");
    expect(renamed?.sheets[0]?.cells.D2?.v).toBe("B");
    expect(renamed?.sheets[0]?.cells.A6?.v).toBe("ECR-2026-001");
    const same = renameListColumn("lst-eng-001", renamed!.sheets, renamed!.revision, engName, "A", "Request");
    expect(same?.bumped).toBe(false);
    const added = addListColumn("lst-eng-001", eng, "A", engName, "K");
    expect(added?.revision).toBe("B");
    expect(added?.sheets[0]?.maxCol).toBe(12);
    expect(added?.sheets[0]?.cells.L5?.v ?? null).toBeNull();
    expect(added?.sheets[0]?.cells.A6?.v).toBe("ECR-2026-001");
    expect(added?.sheets[0]?.merges).toEqual(expect.arrayContaining(["A1:L1"]));
    const dropped = removeListColumn("lst-eng-001", added!.sheets, added!.revision, engName, "L");
    expect(dropped?.revision).toBe("C");
    expect(dropped?.sheets[0]?.maxCol).toBe(11);
    expect(dropped?.sheets[0]?.cells.A5?.v).toBe("ECR Number");

    const schedule = renameListColumn("lst-gen-002", freshSheets("lst-gen-002"), "A", "LST-GEN-002 - Internal Audit Sc", "H", "Findings");
    expect(schedule?.sheets[0]?.cells.H5?.v).toBe("Findings");
    expect(schedule?.sheets[0]?.cells.D2?.v).toBe("B");
    expect(schedule?.sheets[0]?.cells.F3?.v).toBe("Ron Wertz & Maxwell Tollefson");
    const ncrColumn = renameListColumn("lst-ncr-001", freshSheets("lst-ncr-001"), "G", "LST-NCR-001 - NCR", "A", "NCR No.");
    expect(ncrColumn?.revision).toBe("H");
    expect(ncrColumn?.sheets[0]?.cells.B2?.v).toBe("Rev: H");
    expect(ncrColumn?.sheets[0]?.cells.A5?.v).toBe("NCR-2026-001");
    expect(restoreHeaderBlock("lst-eng-001", added!.sheets).sheets[0]?.maxCol).toBe(12);
    expect(restoreHeaderBlock("lst-eng-001", added!.sheets).sheets[0]?.cells.H2?.v).toBe("Maxwell Tollefson");
  });
});
