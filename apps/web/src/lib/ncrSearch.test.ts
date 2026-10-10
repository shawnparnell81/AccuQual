import assert from "node:assert/strict";
import test from "node:test";
import { ncrLinkConfirmation, ncrMatchesStateFilter, ncrPickerRows, type NcrSearchRow } from "./ncrSearch.ts";

const closed: NcrSearchRow = {
  id: 9,
  recordNumber: "DEMO-NCR-001",
  title: "Paint scratch",
  status: "closed",
  siteName: "Wellman",
};

const open: NcrSearchRow = {
  id: 4,
  recordNumber: "DEMO-NCR-002",
  title: "Wrong torque",
  status: "contain",
  siteName: "Greer",
};

test("the NCR list default includes closed rows", () => {
  assert.equal(ncrMatchesStateFilter("closed", ""), true);
  assert.equal(ncrMatchesStateFilter("closed", "all"), true);
  assert.equal(ncrMatchesStateFilter("closed", "contain"), false);
  assert.equal(ncrMatchesStateFilter("contain", "contain"), true);
});

test("the picker finds a closed NCR by number or title and confirms it", () => {
  const rows = ncrPickerRows([closed, open], "demo-ncr-001");
  assert.deepEqual(rows.map((row) => row.id), [9]);
  assert.equal(ncrLinkConfirmation(closed), "Linked: DEMO-NCR-001 (Wellman, Closed)");
  assert.equal(ncrPickerRows([closed, open], "torque").length, 1);
  assert.equal(ncrPickerRows([closed], "missing").length, 0);
  assert.equal(ncrPickerRows([closed, open], "").some((row) => row.status === "closed"), true);
});
