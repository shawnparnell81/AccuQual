import assert from "node:assert/strict";
import test from "node:test";
import { groupDrafts } from "./formDrafts.ts";

test("groups header fields and cells from the same row into one patch", () => {
  const grouped = groupDrafts([
    ["formNo", "QA-14"],
    ["row:3:result", "Pass"],
    ["row:3:note", "Checked"],
    ["additionalComments", "See photo"],
  ]);
  assert.deepEqual(grouped.fields, [
    ["formNo", "QA-14"],
    ["additionalComments", "See photo"],
  ]);
  assert.deepEqual(grouped.rows, [{ rowId: 3, cols: { result: "Pass", note: "Checked" } }]);
});

test("an empty draft list is clean", () => {
  assert.deepEqual(groupDrafts([]), { fields: [], rows: [] });
});
