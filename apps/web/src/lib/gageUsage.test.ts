import assert from "node:assert/strict";
import test from "node:test";
import { gageUsageBlockReason } from "./gageUsage.ts";

test("overdue, failed, inactive, and out-of-service gages are blocked from use", () => {
  assert.equal(gageUsageBlockReason("inactive", "current"), "This gage is inactive and cannot be used.");
  assert.equal(gageUsageBlockReason("out_of_service", "failed"), "This gage is out of service and cannot be used.");
  assert.equal(gageUsageBlockReason("active", "failed"), "This gage failed calibration and cannot be used until it passes.");
  assert.equal(gageUsageBlockReason("active", "overdue"), "This gage is overdue for calibration and cannot be used.");
  assert.equal(gageUsageBlockReason("active", "due_soon"), null);
  assert.equal(gageUsageBlockReason("active", "current"), null);
  assert.equal(gageUsageBlockReason("active", "uncalibrated"), null);
});
