import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isStaleChunkError, shouldReloadForStaleChunk } from "./staleChunk";

describe("stale page file after a deploy", () => {
  it("recognizes the browsers' missing-module errors", () => {
    assert.ok(isStaleChunkError(new TypeError("Failed to fetch dynamically imported module: https://app/assets/ValidationReportDetailPage-abc.js")));
    assert.ok(isStaleChunkError(new TypeError("Importing a module script failed.")));
    assert.ok(isStaleChunkError(new Error("error loading dynamically imported module")));
    assert.ok(!isStaleChunkError(new TypeError("Cannot read properties of undefined (reading 'x')")));
  });
  it("reloads once, not in a loop", () => {
    const err = new TypeError("Failed to fetch dynamically imported module: x.js");
    assert.equal(shouldReloadForStaleChunk(err, null, 1_000_000), true);
    assert.equal(shouldReloadForStaleChunk(err, 1_000_000 - 5_000, 1_000_000), false);
    assert.equal(shouldReloadForStaleChunk(err, 1_000_000 - 120_000, 1_000_000), true);
    assert.equal(shouldReloadForStaleChunk(new Error("boom"), null, 1_000_000), false);
  });
});
