import assert from "node:assert/strict";
import test from "node:test";
import { auditSubject, copyFileName, recordHeading, showRecordNumber } from "./userRecordNumber.ts";

test("a blank record number stays blank and never prints the internal id", () => {
  assert.equal(showRecordNumber(null), "");
  assert.equal(showRecordNumber("   "), "");
  assert.equal(showRecordNumber(undefined), "");
  assert.equal(recordHeading("NCR", ""), "NCR");
  assert.equal(recordHeading("NCR", "  "), "NCR");
  assert.equal(recordHeading("NCR", null).includes("#"), false);
  assert.equal(recordHeading("CAPA", "CAPA-0001"), "CAPA CAPA-0001");
});

test("a typed number is shown as entered", () => {
  assert.equal(showRecordNumber("  QA 14 "), "QA 14");
});

test("a saved-copy file name uses the typed number, otherwise the form id and date", () => {
  assert.equal(copyFileName("{formId}_{recordNumber}_{date}", "FRM-VAL-007", "TEST-1008-03", "2026-09-28T00:00:00.000Z"), "FRM-VAL-007_TEST-1008-03_2026-09-28");
  assert.equal(copyFileName("{formId}_{recordNumber}_{date}", "FRM-VAL-007", "", "2026-09-28T00:00:00.000Z"), "FRM-VAL-007_2026-09-28");
  assert.equal(copyFileName("{formId}_{recordNumber}_{date}", "FRM-NCR-001", null, "2026-10-05").includes("#"), false);
  assert.equal(copyFileName("PSW_{recordNumber}_{date}", "", null, "2026-09-28"), "PSW_2026-09-28");
});

test("an audit subject uses a typed number and never the database id", () => {
  assert.equal(auditSubject("Validation Report", { numberEdit: { label: "Report No.", from: "", to: "TEST-1008-03" } }), "Validation Report TEST-1008-03");
  assert.equal(auditSubject("NCR", {}), "NCR");
  assert.equal(auditSubject("NCR", { recordNumber: "QA-14" }), "NCR QA-14");
  assert.equal(auditSubject("CAPA", null).includes("#"), false);
});
