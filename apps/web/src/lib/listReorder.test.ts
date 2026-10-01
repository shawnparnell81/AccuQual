import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dropPosition, reorderIds } from "./listReorder.ts";

describe("shared list reorder", () => {
  it("splits a flat list into before and after", () => {
    assert.equal(dropPosition(10, 0, 100, false), "before");
    assert.equal(dropPosition(50, 0, 100, false), "after");
    assert.equal(dropPosition(90, 0, 100, false), "after");
  });

  it("keeps nesting to the center band of a folder row", () => {
    assert.equal(dropPosition(10, 0, 100, true), "before");
    assert.equal(dropPosition(39, 0, 100, true), "before");
    assert.equal(dropPosition(50, 0, 100, true), "inside");
    assert.equal(dropPosition(60, 0, 100, true), "inside");
    assert.equal(dropPosition(61, 0, 100, true), "after");
    assert.equal(dropPosition(90, 0, 100, true), "after");
  });

  it("reorders siblings without removing the others", () => {
    assert.deepEqual(reorderIds(["engineering", "quality", "audits"], "audits", "engineering", "before"), ["audits", "engineering", "quality"]);
    assert.deepEqual(reorderIds(["engineering", "quality", "audits"], "engineering", "audits", "after"), ["quality", "audits", "engineering"]);
  });

  it("inserts a row that is joining this list", () => {
    assert.deepEqual(reorderIds(["engineering", "quality"], "capa", "quality", "before"), ["engineering", "capa", "quality"]);
  });

  it("refuses a drop onto itself or a missing target", () => {
    assert.equal(reorderIds(["engineering", "quality"], "quality", "quality", "before"), null);
    assert.equal(reorderIds(["engineering"], "quality", "audits", "after"), null);
  });
});
