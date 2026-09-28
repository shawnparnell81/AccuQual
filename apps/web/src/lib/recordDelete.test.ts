import assert from "node:assert/strict";
import test from "node:test";
import { auditEventLabel, canDeleteRecord, recordDeleteLabel } from "./recordDelete";

test("only an administrator, owner, quality manager, or the record owner can delete", () => {
  assert.equal(canDeleteRecord("admin", 1, []), true);
  assert.equal(canDeleteRecord("owner", 2, []), true);
  assert.equal(canDeleteRecord("quality_manager", 3, []), true);
  assert.equal(canDeleteRecord("operator", 4, [4]), true);
  assert.equal(canDeleteRecord("operator", 4, [9]), false);
  assert.equal(canDeleteRecord("operator", 4, [null]), false);
  assert.equal(canDeleteRecord("read_only", 5, []), false);
});

test("the confirmation and the audit line name the record", () => {
  assert.equal(recordDeleteLabel("NCR", 3, "Bent flange"), 'NCR #3 "Bent flange"');
  assert.equal(recordDeleteLabel("Validation Report", 3, "  "), "Validation Report #3");
  assert.equal(auditEventLabel({ action: "delete", changes: { summary: 'Deleted NCR #3 "Bent flange"' } }), 'Deleted NCR #3 "Bent flange"');
  assert.equal(auditEventLabel({ action: "status_change", changes: null }), "status change");
});
