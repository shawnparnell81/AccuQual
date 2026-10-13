import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTolerance, withinSpec } from "./tolerance.ts";

describe("tolerance parser: the specs on the regular gas lift form", () => {
  it("reads N +/-t", () => {
    assert.deepEqual(parseTolerance("369 +/-2"), { min: 367, max: 371 });
    assert.deepEqual(parseTolerance("126.5 +/-1"), { min: 125.5, max: 127.5 });
    assert.deepEqual(parseTolerance("18 +/- 0.2"), { min: 17.8, max: 18.2 });
    assert.deepEqual(parseTolerance("8 +/- 0.2"), { min: 7.8, max: 8.2 });
  });

  it("reads N +a/-b (and -b/+a)", () => {
    assert.deepEqual(parseTolerance("195 +20/-10"), { min: 185, max: 215 });
    assert.deepEqual(parseTolerance("195 -10/+20"), { min: 185, max: 215 });
    assert.deepEqual(parseTolerance("195+20/-10"), { min: 185, max: 215 });
    assert.deepEqual(parseTolerance("195 + 20 / - 10"), { min: 185, max: 215 });
  });

  it("accepts +-, ± and spacing variations", () => {
    for (const text of ["243 +-2", "243 ±2", "243±2", "243+/-2", "243 + / - 2", "  243   +/-   2  "]) {
      assert.deepEqual(parseTolerance(text), { min: 241, max: 245 }, text);
    }
    assert.deepEqual(parseTolerance("243 ±2"), { min: 241, max: 245 });
  });

  it("reads a typed min and max", () => {
    for (const text of ["185-215", "185 - 215", "185 to 215", "185..215", "min 185 max 215", "Min: 185, Max: 215", "minimum 185 maximum 215"]) {
      assert.deepEqual(parseTolerance(text), { min: 185, max: 215 }, text);
    }
    assert.deepEqual(parseTolerance("-5 to -1"), { min: -5, max: -1 });
    assert.deepEqual(parseTolerance("0.5-1.5"), { min: 0.5, max: 1.5 });
  });

  it("handles negatives and decimals without floating-point noise", () => {
    assert.deepEqual(parseTolerance("-5 +/-1"), { min: -6, max: -4 });
    assert.deepEqual(parseTolerance("18 +/- 0.2"), { min: 17.8, max: 18.2 });
    assert.deepEqual(parseTolerance("0.3 +/-0.1"), { min: 0.2, max: 0.4 });
    assert.deepEqual(parseTolerance(".5 +/-.25"), { min: 0.25, max: 0.75 });
  });

  it("gives no result for anything else, never a guess", () => {
    for (const text of ["", "   ", "243", "N/A", "abc", "17mm/10mm ball", "369 +/-", "+/-2", "369 +/- x", "185-", "-215", "215 to 185", "min 215 max 185", "12 +/- -2", "1e3 +/-2", "10 +/-2 mm", "195 +20", "195 +20/10", "5 ± ±2"]) {
      assert.equal(parseTolerance(text), null, JSON.stringify(text));
    }
    for (const value of [243, null, undefined, true, {}, []]) assert.equal(parseTolerance(value), null);
  });
});

describe("tolerance parser: judging a measurement", () => {
  it("is inside, on the edge, and outside", () => {
    assert.equal(withinSpec("369 +/-2", 369), true);
    assert.equal(withinSpec("369 +/-2", 371), true);
    assert.equal(withinSpec("369 +/-2", 367), true);
    assert.equal(withinSpec("369 +/-2", 371.01), false);
    assert.equal(withinSpec("369 +/-2", 366.9), false);
  });

  it("an edge value passes despite binary rounding", () => {
    assert.equal(withinSpec("18 +/- 0.2", 18.2), true);
    assert.equal(withinSpec("18 +/- 0.2", 17.8), true);
    assert.equal(withinSpec("18 +/- 0.2", 18.21), false);
    assert.equal(withinSpec("0.3 +/-0.1", 0.4), true);
  });

  it("asymmetric specs use the right side for each limit", () => {
    assert.equal(withinSpec("195 +20/-10", 215), true);
    assert.equal(withinSpec("195 +20/-10", 185), true);
    assert.equal(withinSpec("195 +20/-10", 216), false);
    assert.equal(withinSpec("195 +20/-10", 184), false);
  });

  it("cannot judge without a range or without a number", () => {
    assert.equal(withinSpec("243", 243), null);
    assert.equal(withinSpec("garbage", 5), null);
    assert.equal(withinSpec("369 +/-2", null), null);
    assert.equal(withinSpec("369 +/-2", "369"), null);
    assert.equal(withinSpec("369 +/-2", Number.NaN), null);
  });
});
