import { describe, expect, it } from "vitest";
import { aqlLookup, codeLetterFor, lotResult, SAMPLE_SIZES, REDUCED_SAMPLE_SIZES } from "../../src/modules/fai-inspection/aql.js";

describe("Z1.4 Table I code letters", () => {
  it("lot 500, level II -> H", () => {
    expect(codeLetterFor(500, "II")).toBe("H");
  });
  it("never returns letter I", () => {
    for (const lot of [10, 100, 1000, 10000, 100000, 600000]) {
      for (const level of ["I", "II", "III", "S-1", "S-2", "S-3", "S-4"] as const) {
        expect(codeLetterFor(lot, level)).not.toBe("I");
      }
    }
  });
});

describe("Table II-A (Normal) — required checks", () => {
  it("F@1.0 -> n13 Ac0/Re1 (arrow up to E)", () => {
    // Lot 91-150, level II -> F. F@1.0 arrows up to E.
    const r = aqlLookup(120, "II", "Normal", "1.0");
    expect(r.codeLetter).toBe("E");
    expect(r.sampleSize).toBe(13);
    expect(r.ac).toBe(0);
    expect(r.re).toBe(1);
  });
  it("G@1.0 -> n50 Ac1/Re2 (arrow down to H)", () => {
    // Lot 151-280, level II -> G. G@1.0 arrows down to H.
    const r = aqlLookup(200, "II", "Normal", "1.0");
    expect(r.codeLetter).toBe("H");
    expect(r.sampleSize).toBe(50);
    expect(r.ac).toBe(1);
    expect(r.re).toBe(2);
  });
  it("F@2.5 -> n20 Ac1/Re2 (direct)", () => {
    const r = aqlLookup(120, "II", "Normal", "2.5");
    expect(r.codeLetter).toBe("F");
    expect(r.sampleSize).toBe(20);
    expect(r.ac).toBe(1);
    expect(r.re).toBe(2);
  });
  it("H@1.0 -> n50 Ac1/Re2 (direct)", () => {
    const r = aqlLookup(500, "II", "Normal", "1.0");
    expect(r.codeLetter).toBe("H");
    expect(r.sampleSize).toBe(50);
    expect(r.ac).toBe(1);
    expect(r.re).toBe(2);
  });
  it("H@0.40 -> n32 Ac0/Re1 (arrow up to G)", () => {
    const r = aqlLookup(500, "II", "Normal", "0.40");
    expect(r.codeLetter).toBe("G");
    expect(r.sampleSize).toBe(32);
    expect(r.ac).toBe(0);
    expect(r.re).toBe(1);
  });
  it("K@1.0 -> n125 Ac3/Re4 (direct)", () => {
    // Lot 501-1200, level II -> J. Use level III for K: lot 501-1200, III -> K.
    const r = aqlLookup(800, "III", "Normal", "1.0");
    expect(r.codeLetter).toBe("K");
    expect(r.sampleSize).toBe(125);
    expect(r.ac).toBe(3);
    expect(r.re).toBe(4);
  });
});

describe("Table II-B (Tightened) spot-checks", () => {
  it("H@1.0 tightened is stricter than normal", () => {
    const normal = aqlLookup(500, "II", "Normal", "1.0");
    const tight = aqlLookup(500, "II", "Tightened", "1.0");
    expect(tight.ac).toBeLessThanOrEqual(normal.ac);
    expect(tight.sampleSize).toBe(50);
  });
  it("uses row S for large lots", () => {
    expect(SAMPLE_SIZES["S"]).toBe(3150);
  });
});

describe("Table II-C (Reduced) spot-checks", () => {
  it("uses reduced sample sizes", () => {
    expect(REDUCED_SAMPLE_SIZES["H"]).toBe(20);
    expect(REDUCED_SAMPLE_SIZES["J"]).toBe(32);
  });
  it("H@1.0 reduced uses smaller n than normal", () => {
    const normal = aqlLookup(500, "II", "Normal", "1.0");
    const reduced = aqlLookup(500, "II", "Reduced", "1.0");
    expect(reduced.sampleSize).toBeLessThan(normal.sampleSize);
  });
});

describe("critical characteristics always Ac0/Re1", () => {
  it("ignores the table for critical", () => {
    const r = aqlLookup(500, "II", "Normal", "1.0", true);
    expect(r.ac).toBe(0);
    expect(r.re).toBe(1);
  });
});

describe("lot result", () => {
  it("fails on any critical defect", () => {
    expect(lotResult({ criticalDefects: 1, majorDefects: 0, minorDefects: 0, reMajor: 2, reMinor: 3 })).toBe("fail");
  });
  it("fails when major defects reach Re", () => {
    expect(lotResult({ criticalDefects: 0, majorDefects: 2, minorDefects: 0, reMajor: 2, reMinor: 3 })).toBe("fail");
  });
  it("passes below all Re numbers", () => {
    expect(lotResult({ criticalDefects: 0, majorDefects: 1, minorDefects: 2, reMajor: 2, reMinor: 3 })).toBe("pass");
  });
});
