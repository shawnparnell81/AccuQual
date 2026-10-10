import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keepSubmenuWhileTraveling, movingTowardSubmenu, pointInTriangle, type HoverRect } from "./menuHoverIntent.ts";

const submenu: HoverRect = { top: 100, right: 620, bottom: 280, left: 400 };

describe("movingTowardSubmenu", () => {
  it("treats the submenu itself as part of the hover path", () => {
    assert.equal(movingTowardSubmenu({ x: 410, y: 120 }, { x: 360, y: 110 }, submenu, "right"), true);
  });

  it("keeps a diagonal move from the parent row inside the safe triangle", () => {
    const origin = { x: 360, y: 110 };
    assert.equal(movingTowardSubmenu({ x: 380, y: 160 }, origin, submenu, "right"), true);
    assert.equal(pointInTriangle({ x: 380, y: 160 }, origin, { x: 400, y: 92 }, { x: 400, y: 288 }), true);
  });

  it("lets a move onto another row, away from the submenu, switch", () => {
    assert.equal(movingTowardSubmenu({ x: 200, y: 240 }, { x: 360, y: 110 }, submenu, "right"), false);
  });

  it("uses the right edge when the submenu opens to the left", () => {
    const flipped: HoverRect = { top: 80, right: 200, bottom: 260, left: 20 };
    const origin = { x: 220, y: 100 };
    assert.equal(movingTowardSubmenu({ x: 210, y: 140 }, origin, flipped, "left"), true);
    assert.equal(movingTowardSubmenu({ x: 280, y: 220 }, origin, flipped, "left"), false);
  });
});

describe("keepSubmenuWhileTraveling", () => {
  it("holds the submenu while the pointer keeps moving toward it", () => {
    assert.equal(keepSubmenuWhileTraveling(true, 12), true);
  });

  it("releases the submenu when the pointer stops or leaves the triangle", () => {
    assert.equal(keepSubmenuWhileTraveling(true, 0), false);
    assert.equal(keepSubmenuWhileTraveling(false, 20), false);
  });
});
