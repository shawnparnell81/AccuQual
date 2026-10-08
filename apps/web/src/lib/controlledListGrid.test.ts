import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { headerBandEnd, moveAddr } from "./controlledListGrid.ts";

describe("controlled list grid movement", () => {
  const bounds = { minRow: 1, maxRow: 8, maxCol: 4 };

  it("moves with the arrows and stops at the edge", () => {
    assert.equal(moveAddr("B3", "ArrowRight", bounds), "C3");
    assert.equal(moveAddr("B3", "ArrowLeft", bounds), "A3");
    assert.equal(moveAddr("B3", "ArrowUp", bounds), "B2");
    assert.equal(moveAddr("B3", "ArrowDown", bounds), "B4");
    assert.equal(moveAddr("A1", "ArrowLeft", bounds), null);
    assert.equal(moveAddr("A1", "ArrowUp", bounds), null);
    assert.equal(moveAddr("D8", "ArrowRight", bounds), null);
    assert.equal(moveAddr("D8", "ArrowDown", bounds), null);
  });

  it("keeps the header band above the column titles", () => {
    assert.equal(headerBandEnd(6), 5);
    assert.equal(headerBandEnd(4), 3);
    assert.equal(headerBandEnd(3), 2);
  });
});