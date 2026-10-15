import assert from "node:assert/strict";
import test from "node:test";
import { canDeleteRecord, canViewAuditLog, recordDeleteLabel } from "./recordDelete";

test("only an administrator, owner, quality manager, or the record owner can delete", () => {
  assert.equal(canDeleteRecord(true, 1, []), true);
  assert.equal(canDeleteRecord(true, 2, [9]), true);
  assert.equal(canDeleteRecord(true, 3, [null]), true);
  assert.equal(canDeleteRecord(false, 4, [4]), true);
  assert.equal(canDeleteRecord(false, 4, [9]), false);
  assert.equal(canDeleteRecord(false, 4, [null]), false);
  assert.equal(canDeleteRecord(false, 5, []), false);
});

test("any signed-in role can open the company audit log", () => {
  assert.equal(canViewAuditLog("admin"), true);
  assert.equal(canViewAuditLog("owner"), true);
  assert.equal(canViewAuditLog("quality_manager"), true);
  assert.equal(canViewAuditLog("operator"), true);
  assert.equal(canViewAuditLog(undefined), false);
});

test("the confirmation names the record and leaves a blank number blank", () => {
  assert.equal(recordDeleteLabel("NCR", "Bent flange", "QA-14"), 'NCR QA-14 "Bent flange"');
  assert.equal(recordDeleteLabel("NCR", "Bent flange", "  "), 'NCR "Bent flange"');
  assert.equal(recordDeleteLabel("NCR", "Bent flange"), 'NCR "Bent flange"');
  assert.equal(recordDeleteLabel("Validation Report", "  ", null), "Validation Report");
  assert.equal(recordDeleteLabel("NCR", "Bent flange", "3").includes("#"), false);
});
