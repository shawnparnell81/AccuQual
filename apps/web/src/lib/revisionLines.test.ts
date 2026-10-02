import assert from "node:assert/strict";
import test from "node:test";
import { pairRevisionLines } from "./revisionLines.ts";

test("marks only the lines that differ between two revisions", () => {
  const rows = pairRevisionLines("Keep\nOld line\nTail", "Keep\nNew line\nTail\nExtra");
  assert.equal(rows.filter((row) => row.changed).length, 2);
  assert.deepEqual(rows[0], { left: "Keep", right: "Keep", changed: false });
  assert.deepEqual(rows[1], { left: "Old line", right: "New line", changed: true });
  assert.deepEqual(rows[3], { left: "", right: "Extra", changed: true });
});
