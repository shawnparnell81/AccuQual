import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { placeMenuFlyout, type MenuRect } from "./menuFlyout.ts";

function anchor(partial: Partial<MenuRect>): MenuRect {
  return { top: 80, right: 400, bottom: 112, left: 240, width: 160, height: 32, ...partial };
}

describe("placeMenuFlyout", () => {
  it("opens to the right of the row when the panel fits", () => {
    const placed = placeMenuFlyout(anchor({}), { width: 220, height: 180 }, { width: 1200, height: 800 });
    assert.equal(placed.left, 392);
    assert.equal(placed.top, 80);
    assert.equal(placed.side, "right");
    assert.ok(placed.left < anchor({}).right);
  });

  it("opens to the left when the right edge would leave the window", () => {
    const placed = placeMenuFlyout(anchor({ left: 980, right: 1140 }), { width: 220, height: 160 }, { width: 1200, height: 800 });
    assert.equal(placed.left, 768);
    assert.equal(placed.side, "left");
    assert.ok(placed.left + 220 <= 1200 - 8);
  });

  it("shifts up when the panel would run past the bottom", () => {
    const placed = placeMenuFlyout(anchor({ top: 700, bottom: 732 }), { width: 200, height: 240 }, { width: 1200, height: 800 });
    assert.equal(placed.top, 552);
    assert.ok(placed.top + 240 <= 800 - 8);
  });

  it("stays inside a short window", () => {
    const placed = placeMenuFlyout(anchor({ top: 4, left: 4, right: 40 }), { width: 300, height: 500 }, { width: 320, height: 400 });
    assert.ok(placed.left >= 8);
    assert.ok(placed.left + 300 <= 320 - 8);
    assert.ok(placed.top >= 8);
    assert.ok(placed.top + 500 <= 400 - 8 || placed.top === 8);
  });
});
