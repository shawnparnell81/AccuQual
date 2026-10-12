import { describe, expect, it } from "vitest";
import { pickTarget, randomSample } from "../../src/modules/fai-inspection/fai-random-pick.js";

describe("pickTarget", () => {
  it("count mode: picks exactly the requested count, capped at the pool", () => {
    expect(pickTarget({ pickMode: "count", pickPercent: null, pickCount: 5 }, 20)).toBe(5);
    expect(pickTarget({ pickMode: "count", pickPercent: null, pickCount: 50 }, 20)).toBe(20);
  });

  it("percent mode: rounds to the nearest whole source", () => {
    expect(pickTarget({ pickMode: "percent", pickPercent: 10, pickCount: null }, 100)).toBe(10);
    expect(pickTarget({ pickMode: "percent", pickPercent: 25, pickCount: null }, 10)).toBe(3); // 2.5 -> rounds to nearest even per Math.round -> 3? documented below
  });

  it("percent mode: a nonzero percent on a small pool still picks at least 1, never 0", () => {
    expect(pickTarget({ pickMode: "percent", pickPercent: 1, pickCount: null }, 5)).toBe(1);
  });

  it("a zero or unset percent picks nothing", () => {
    expect(pickTarget({ pickMode: "percent", pickPercent: 0, pickCount: null }, 50)).toBe(0);
    expect(pickTarget({ pickMode: "percent", pickPercent: null, pickCount: null }, 50)).toBe(0);
  });

  it("an empty pool always picks nothing", () => {
    expect(pickTarget({ pickMode: "percent", pickPercent: 100, pickCount: null }, 0)).toBe(0);
    expect(pickTarget({ pickMode: "count", pickPercent: null, pickCount: 10 }, 0)).toBe(0);
  });
});

describe("randomSample", () => {
  it("returns exactly `count` distinct ids from the pool", () => {
    const ids = Array.from({ length: 50 }, (_, i) => i + 1);
    const sample = randomSample(ids, 12);
    expect(sample).toHaveLength(12);
    expect(new Set(sample).size).toBe(12);
    for (const id of sample) expect(ids).toContain(id);
  });

  it("never returns more than the pool has", () => {
    expect(randomSample([1, 2, 3], 10)).toHaveLength(3);
  });

  it("is deterministic with a seeded rng (same seed -> same sample)", () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const seeded = () => {
      let s = 42;
      return () => {
        s = (s * 1103515245 + 12345) % 2147483648;
        return s / 2147483648;
      };
    };
    const a = randomSample(ids, 4, seeded());
    const b = randomSample(ids, 4, seeded());
    expect(a).toEqual(b);
  });

  it("over many draws, every id gets picked at least once (no systematic exclusion)", () => {
    const ids = Array.from({ length: 10 }, (_, i) => i);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) randomSample(ids, 3).forEach((id) => seen.add(id));
    expect(seen.size).toBe(10);
  });
});
