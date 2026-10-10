import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dragScrollDelta, paneScrollDelta, windowEdgeScrollDelta } from "./dragAutoScroll.ts";

describe("drag auto-scroll", () => {
  it("scrolls up near the top edge and down near the bottom edge", () => {
    assert.ok(dragScrollDelta(10, 0, 400) < 0);
    assert.ok(dragScrollDelta(390, 0, 400) > 0);
    assert.equal(dragScrollDelta(200, 0, 400), 0);
  });

  it("keeps scrolling when the pointer is just outside the pane", () => {
    assert.ok(dragScrollDelta(-10, 0, 400) < 0);
    assert.ok(dragScrollDelta(410, 0, 400) > 0);
    assert.equal(dragScrollDelta(-40, 0, 400), 0);
  });

  it("moves faster closer to the edge", () => {
    const near = Math.abs(dragScrollDelta(0, 0, 400));
    const far = Math.abs(dragScrollDelta(50, 0, 400));
    assert.ok(near > far);
  });

  it("scrolls the window when a drag is near the viewport edge", () => {
    assert.ok(windowEdgeScrollDelta(8, 800) < 0);
    assert.ok(windowEdgeScrollDelta(790, 800) > 0);
    assert.equal(windowEdgeScrollDelta(400, 800), 0);
    assert.equal(windowEdgeScrollDelta(-40, 800), 0);
  });

  it("scrolls only the pane the pointer is over", () => {
    const rect = { left: 0, top: 0, right: 200, bottom: 400 };
    assert.ok(paneScrollDelta(20, 8, rect, "auto", 800, 400) < 0);
    assert.equal(paneScrollDelta(260, 8, rect, "auto", 800, 400), 0);
    assert.equal(paneScrollDelta(20, 8, rect, "hidden", 800, 400), 0);
    assert.equal(paneScrollDelta(20, 8, rect, "auto", 400, 400), 0);
  });
});
