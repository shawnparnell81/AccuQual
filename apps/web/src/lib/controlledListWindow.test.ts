import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rowWindow } from "./controlledListWindow";

const rows = (n: number, px = 20) => Array.from({ length: n }, () => px);

describe("rowWindow", () => {
  it("builds the first screen and the margin when the grid is at the top", () => {
    assert.deepEqual(rowWindow(rows(1000), 0, 200, 5, 10), { from: 5, to: 5 + 9 + 10 });
  });
  it("follows the scroll position", () => {
    // 2000 px down is row index 100; 200 px tall shows indexes 100 to 109
    assert.deepEqual(rowWindow(rows(1000), 2000, 200, 1, 10), { from: 91, to: 120 });
  });
  it("treats a grid lower on the page as scrolled to its top", () => {
    assert.deepEqual(rowWindow(rows(1000), -300, 400, 1, 0), { from: 1, to: 5 });
  });
  it("stays inside the sheet at the bottom", () => {
    assert.deepEqual(rowWindow(rows(50), 5000, 400, 1, 10), { from: 40, to: 50 });
  });
  it("handles rows of different heights", () => {
    assert.deepEqual(rowWindow([10, 50, 10, 10, 10], 55, 10, 1, 0), { from: 2, to: 3 });
  });
});
