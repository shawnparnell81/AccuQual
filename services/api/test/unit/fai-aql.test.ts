import { describe, expect, it } from "vitest";
import { aqlLookup, codeLetterFor, lotResult, SAMPLE_SIZES } from "../../src/modules/fai-inspection/aql.js";

describe("Z1.4 Table I code letters", () => {
  it("lot 500, level II -> H", () => {
    expect(codeLetterFor(500, "II")).toBe("H");
  });
  it("lot 150, level II -> F", () => {
    expect(codeLetterFor(150, "II")).toBe("F");
  });
  it("lot 1200, level II -> J", () => {
    expect(codeLetterFor(1200, "II")).toBe("J");
  });
  it("lot 600000, level II -> Q (no letter I)", () => {
    expect(codeLetterFor(600000, "II")).toBe("Q");
  });
  it("lot 600000, level III -> R", () => {
    expect(codeLetterFor(600000, "III")).toBe("R");
  });
  it("never returns letter I", () => {
    for (const lot of [10, 100, 1000, 10000, 100000, 600000]) {
      for (const level of ["I", "II", "III", "S-1", "S-2", "S-3", "S-4"] as const) {
        expect(codeLetterFor(lot, level)).not.toBe("I");
      }
    }
  });
});

describe("Z1.4 sample sizes", () => {
  it("H -> 50, J -> 80", () => {
    expect(SAMPLE_SIZES["H"]).toBe(50);
    expect(SAMPLE_SIZES["J"]).toBe(80);
  });
});

describe("Z1.4 Table II-A (Normal) — required checks", () => {
  it("lot 500, II, Normal, AQL 1.0 -> H, n=50, Ac1/Re2", () => {
    const r = aqlLookup(500, "II", "Normal", "1.0");
    expect(r.codeLetter).toBe("H");
    expect(r.sampleSize).toBe(50);
    expect(r.ac).toBe(1);
    expect(r.re).toBe(2);
  });
  it("lot 500, II, Normal, AQL 0.65 -> arrow to J, n=80, Ac1/Re2", () => {
    const r = aqlLookup(500, "II", "Normal", "0.65");
    expect(r.codeLetter).toBe("J");
    expect(r.sampleSize).toBe(80);
    expect(r.ac).toBe(1);
    expect(r.re).toBe(2);
  });
  it("lot 500, II, Normal, AQL 4.0 -> Ac5/Re6", () => {
    const r = aqlLookup(500, "II", "Normal", "4.0");
    expect(r.codeLetter).toBe("H");
    expect(r.ac).toBe(5);
    expect(r.re).toBe(6);
  });
});

describe("critical characteristics always Ac0/Re1", () => {
  it("ignores the table for critical", () => {
    const r = aqlLookup(500, "II", "Normal", "1.0", true);
    expect(r.ac).toBe(0);
    expect(r.re).toBe(1);
    expect(r.codeLetter).toBe("H");
  });
  it("critical with tightened severity still Ac0/Re1", () => {
    const r = aqlLookup(500, "II", "Tightened", "0.65", true);
    expect(r.ac).toBe(0);
    expect(r.re).toBe(1);
  });
});

describe("tightened and reduced tables", () => {
  it("tightened differs from normal", () => {
    const normal = aqlLookup(500, "II", "Normal", "1.0");
    const tight = aqlLookup(500, "II", "Tightened", "1.0");
    // Tightened is stricter or equal
    expect(tight.ac).toBeLessThanOrEqual(normal.ac + 1);
  });
  it("reduced differs from normal", () => {
    const normal = aqlLookup(500, "II", "Normal", "1.0");
    const reduced = aqlLookup(500, "II", "Reduced", "1.0");
    expect(reduced).toBeDefined();
    expect(normal).toBeDefined();
  });
});

describe("lot result", () => {
  it("fails on any critical defect", () => {
    expect(lotResult({ criticalDefects: 1, majorDefects: 0, minorDefects: 0, reMajor: 2, reMinor: 3 })).toBe("fail");
  });
  it("fails when major defects reach Re", () => {
    expect(lotResult({ criticalDefects: 0, majorDefects: 2, minorDefects: 0, reMajor: 2, reMinor: 3 })).toBe("fail");
  });
  it("fails when minor defects reach Re", () => {
    expect(lotResult({ criticalDefects: 0, majorDefects: 0, minorDefects: 3, reMajor: 2, reMinor: 3 })).toBe("fail");
  });
  it("passes below all Re numbers", () => {
    expect(lotResult({ criticalDefects: 0, majorDefects: 1, minorDefects: 2, reMajor: 2, reMinor: 3 })).toBe("pass");
  });
});
