import assert from "node:assert/strict";
import test from "node:test";
import { canDeleteRecord, canViewAuditLog, recordDeleteLabel } from "./recordDelete";

test("only an administrator, owner, quality manager, or the record owner can delete", () => {
  assert.equal(canDeleteRecord("admin", 1, []), true);
  assert.equal(canDeleteRecord("owner", 2, []), true);
  assert.equal(canDeleteRecord("quality_manager", 3, []), true);
  assert.equal(canDeleteRecord("operator", 4, [4]), true);
  assert.equal(canDeleteRecord("operator", 4, [9]), false);
  assert.equal(canDeleteRecord("operator", 4, [null]), false);
  assert.equal(canDeleteRecord("read_only", 5, []), false);
});

test("any signed-in role can open the company audit log", () => {
  assert.equal(canViewAuditLog("admin"), true);
  assert.equal(canViewAuditLog("owner"), true);
  assert.equal(canViewAuditLog("quality_manager"), true);
  assert.equal(canViewAuditLog("operator"), true);
  assert.equal(canViewAuditLog(undefined), false);
});

test("the confirmation names the record", () => {
  assert.equal(recordDeleteLabel("NCR", 3, "Bent flange"), 'NCR #3 "Bent flange"');
  assert.equal(recordDeleteLabel("Validation Report", 3, "  "), "Validation Report #3");
});
