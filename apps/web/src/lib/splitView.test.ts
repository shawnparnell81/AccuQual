import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampSplitRatio,
  paneLocation,
  readSplit,
  resolvePaneTarget,
  swapPanePaths,
  writeSplit,
} from "./splitView.ts";

describe("split view", () => {
  it("round-trips the right pane through the hash without touching another query", () => {
    const hash = writeSplit("", true, "/capa/4?view=board");
    assert.equal(readSplit(hash).open, true);
    assert.equal(readSplit(hash).path, "/capa/4?view=board");
    assert.equal(readSplit(writeSplit(hash, false, null)).open, false);
    assert.equal(writeSplit("#other=1", true, "/ncr/2"), "#other=1&split=%2Fncr%2F2");
  });

  it("keeps an open split with an empty right pane", () => {
    const hash = writeSplit("", true, null);
    assert.deepEqual(readSplit(hash), { open: true, path: null });
  });

  it("gives each pane its own search string", () => {
    const left = paneLocation("/ncr/12?new=1");
    const right = paneLocation("/capa?view=board");
    assert.equal(left.search, "?new=1");
    assert.equal(right.search, "?view=board");
    assert.notEqual(left.pathname, right.pathname);
    right.search = "?view=list";
    assert.equal(left.search, "?new=1");
  });

  it("resolves a right-pane navigation against that pane only", () => {
    assert.equal(resolvePaneTarget("/capa", "?view=board"), "/capa?view=board");
    assert.equal(resolvePaneTarget("/capa?view=board", "/ncr/3"), "/ncr/3");
    assert.equal(resolvePaneTarget("/documents/folders?folder=4", { search: "" }), "/documents/folders");
  });

  it("swaps the two pane paths", () => {
    assert.deepEqual(swapPanePaths("/ncr/1", "/capa/2"), { left: "/capa/2", right: "/ncr/1" });
  });

  it("clamps the divider", () => {
    assert.equal(clampSplitRatio(0.5), 0.5);
    assert.equal(clampSplitRatio(0.01), 0.22);
    assert.equal(clampSplitRatio(0.99), 0.78);
    assert.equal(clampSplitRatio(Number.NaN), 0.5);
  });
});
