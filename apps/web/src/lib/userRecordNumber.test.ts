import assert from "node:assert/strict";
import test from "node:test";
import { recordHeading, showRecordNumber } from "./userRecordNumber.ts";

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
