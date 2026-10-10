import assert from "node:assert/strict";
import test from "node:test";
import { blankDraftState, isDeferredCreatePath, readBlankDraft, unsavedBlankPath } from "./blankDraft.ts";
import { BEGIN_EDIT_ERROR } from "./beginEdit.ts";
import { headerStatusFor } from "./headerStatus.ts";
import { plantSelectOptions } from "./plantOptions.ts";
import { filedToast, saveShouldLock } from "./saveFiling.ts";
import { blankCells as fuelBlank } from "./fuelPumpReport.ts";
import { blankCells, FORMULA_TEXT } from "./validationReport.ts";
import { buildSheetRows } from "./validationReportSheet.ts";
import { formatAuditLine } from "./auditLine.ts";

test("plant options use the same string ids as the top bar and keep a missing plant visible", () => {
  const options = plantSelectOptions(
    [
      { id: 6, name: "Greer", status: "active" },
      { id: 7, name: "Wellman", status: "active" },
    ],
    { siteId: 7, siteName: "Wellman" },
  );
  assert.deepEqual(options.map((option) => option.value), ["6", "7"]);
  assert.equal(options.find((option) => option.value === "7")?.label, "Wellman");

  const hidden = plantSelectOptions([{ id: 6, name: "Greer", status: "active" }], { siteId: 7, siteName: "Wellman" });
  assert.equal(hidden[0]?.value, "7");
  assert.equal(hidden[0]?.label, "Wellman");
});

test("blank forms for validation, ISO, and QMS do not post until save", () => {
  assert.equal(isDeferredCreatePath("/validation-reports"), true);
  assert.equal(isDeferredCreatePath("/ncr"), false);
  const state = blankDraftState({ createPath: "/validation-reports", body: { data: { formType: "csa" } } });
  assert.equal(unsavedBlankPath("/validation-reports/{id}"), "/validation-reports/new");
  assert.equal(readBlankDraft(state, "/validation-reports")?.createPath, "/validation-reports");
  assert.equal(blankDraftState({ createPath: "/ncr", body: {} }), null);
});

test("a blank CSA sheet is not started, and one sample is in progress", () => {
  assert.equal(headerStatusFor("csa", blankCells()), "Not started");
  const started = blankCells();
  started.D12 = 10;
  assert.equal(headerStatusFor("csa", started), "In progress");
  assert.equal(headerStatusFor("fuel_pump", fuelBlank()), "Not started");
});

test("FRM-VAL-007 stays in progress on an incomplete fuel pump sheet and plain Save does not file it", () => {
  const cells = fuelBlank();
  cells.B6 = "DEMO-PUMP";
  cells.G13 = 1;
  assert.equal(headerStatusFor("fuel_pump", cells), "In progress");
  assert.equal(saveShouldLock(false), false);
});

test("Pass and Fail show only when the measurements and a disposition are complete", () => {
  const cells = blankCells();
  for (const [key, value] of Object.entries(cells)) {
    if (key in FORMULA_TEXT) continue;
    if (value === "") cells[key] = 10;
  }
  cells.B51 = true;
  assert.equal(headerStatusFor("csa", cells), "Pass");
  cells.D12 = 9;
  assert.equal(headerStatusFor("csa", cells), "Fail");
  cells.B51 = false;
  assert.equal(headerStatusFor("csa", cells), "In progress");
});

test("plain Save does not lock an unfiled record, and filing says where it went", () => {
  assert.equal(saveShouldLock(false), false);
  assert.equal(saveShouldLock(true), true);
  assert.equal(filedToast("Validation / CSA"), "Filed to Validation / CSA and locked");
});

test("edit timeout has a retry message", () => {
  assert.match(BEGIN_EDIT_ERROR, /Try again/);
});

test("damper and coil Sample 2 cells stay ungraded, matching the workbook", () => {
  const rows = buildSheetRows();
  const cell = (addr: string) => rows.flat().find((item) => item.addr === addr);
  for (const row of [22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 36, 37, 39, 40]) {
    assert.equal(cell(`G${row}`)?.kind, "gray", `G${row}`);
    assert.equal(FORMULA_TEXT[`G${row}`], undefined);
  }
  assert.equal(cell("G41")?.kind, "calc");
  assert.match(FORMULA_TEXT.G41 ?? "", /E41/);
  assert.equal(cell("D14")?.kind, "calc");
  assert.equal(cell("E14")?.kind, "input");
});

test("template defaults and an empty edit are not logged as cell changes, and periods are not doubled", () => {
  const first = formatAuditLine({
    action: "update",
    changes: { event: "form_saved", edits: [{ label: "Cell B8", from: "(blank)", to: "Shawn Parnell." }] },
    performedByName: "Form Auditor",
  });
  assert.equal(first.description.includes(".."), false);

  const opened = formatAuditLine({
    action: "update",
    changes: { event: "edit_started" },
    fieldChanges: [{ op: "UPDATE", changes: { data: { from: { cells: {} }, to: { cells: { B8: "Shawn Parnell", B12: 10 } } } } }],
  });
  assert.match(opened.description, /Opened the form for editing/);
  assert.equal(opened.description.includes("Cell B8"), false);
  assert.equal(opened.description.includes("Cells changed"), false);
});
