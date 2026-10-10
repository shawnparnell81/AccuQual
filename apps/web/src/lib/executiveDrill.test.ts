import assert from "node:assert/strict";
import test from "node:test";
import { drillHeading, drillTooltip, executiveListPath } from "./executiveDrill.ts";

const greerFai = {
  kind: "fai",
  bucket: "open",
  label: "Open",
  dateRange: "90d",
  siteId: 6,
  siteName: "Greer",
  value: 3,
};

test("an open FAI count is titled and tooltipped for that plant", () => {
  assert.equal(drillTooltip(greerFai), "Open 3 open FAIs at Greer");
  assert.equal(drillHeading(greerFai), "Open FAIs — Greer (3)");
  assert.equal(executiveListPath(greerFai), "/executive/list?kind=fai&bucket=open&dateRange=90d&siteId=6");
});

test("a zero count says there is nothing to open", () => {
  assert.equal(drillTooltip({ ...greerFai, value: 0 }), "No open FAIs at Greer");
});

test("a Wellman number keeps the Wellman plant", () => {
  assert.equal(
    drillTooltip({ ...greerFai, kind: "open_ncrs", bucket: "open", label: "Open", siteId: 2, siteName: "Wellman", value: 1 }),
    "Open 1 open NCR at Wellman",
  );
  assert.equal(executiveListPath({ ...greerFai, siteId: null }).includes("siteId=unassigned"), true);
});
