import { describe, expect, it } from "vitest";
import { AQL_VALUES, aqlLookup, codeLetterFor, lotResult, SAMPLE_SIZES, REDUCED_SAMPLE_SIZES } from "../../src/modules/fai-inspection/aql.js";

// Expected values below are read off the printed ANSI/ASQ Z1.4-2003 Tables I, II-A, II-B, II-C.
type Sev = "Normal" | "Tightened" | "Reduced";
function check(lot: number, level: "II" | "III", sev: Sev, aql: string, code: string, n: number, ac: number, re: number) {
  const r = aqlLookup(lot, level, sev, aql);
  expect({ code: r.codeLetter, n: r.sampleSize, ac: r.ac, re: r.re }).toEqual({ code, n, ac, re });
}

describe("Z1.4 Table I code letters", () => {
  it("level II ranges", () => {
    expect(codeLetterFor(20, "II")).toBe("C");
    expect(codeLetterFor(90, "II")).toBe("E");
    expect(codeLetterFor(91, "II")).toBe("F");
    expect(codeLetterFor(150, "II")).toBe("F");
    expect(codeLetterFor(500, "II")).toBe("H");
    expect(codeLetterFor(2000, "II")).toBe("K");
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

describe("Table II-A (Normal)", () => {
  it("H@1.0 -> n50 Ac1/Re2", () => check(500, "II", "Normal", "1.0", "H", 50, 1, 2));
  it("F@1.0 -> up arrow to E, n13 Ac0/Re1", () => check(120, "II", "Normal", "1.0", "E", 13, 0, 1));
  it("G@1.0 -> down arrow to H, n50 Ac1/Re2", () => check(200, "II", "Normal", "1.0", "H", 50, 1, 2));
  it("F@2.5 -> n20 Ac1/Re2", () => check(120, "II", "Normal", "2.5", "F", 20, 1, 2));
  it("K@1.0 -> n125 Ac3/Re4", () => check(2000, "II", "Normal", "1.0", "K", 125, 3, 4));
  it("H@0.40 -> up arrow to G, n32 Ac0/Re1", () => check(500, "II", "Normal", "0.40", "G", 32, 0, 1));
  it("C@10 -> n5 Ac1/Re2", () => check(20, "II", "Normal", "10.0", "C", 5, 1, 2));
  it("A@10 -> down arrow to C, n5 Ac1/Re2", () => check(5, "II", "Normal", "10.0", "C", 5, 1, 2));
  it("R@0.015 -> up arrow to P, n800 Ac0/Re1", () => check(600000, "III", "Normal", "0.015", "P", 800, 0, 1));
  it("H@4.0 -> n50 Ac5/Re6", () => check(500, "II", "Normal", "4.0", "H", 50, 5, 6));
});

describe("Table II-B (Tightened)", () => {
  it("R@0.010 -> n2000 Ac0/Re1", () => check(600000, "III", "Tightened", "0.010", "R", 2000, 0, 1));
  it("K@1.0 -> n125 Ac2/Re3", () => check(2000, "II", "Tightened", "1.0", "K", 125, 2, 3));
  it("H@1.0 -> down arrow to J, n80 Ac1/Re2", () => check(500, "II", "Tightened", "1.0", "J", 80, 1, 2));
  it("R@0.025 -> down arrow to row S, n3150 Ac1/Re2", () => check(600000, "III", "Tightened", "0.025", "S", 3150, 1, 2));
  it("H@4.0 -> n50 Ac3/Re4", () => check(500, "II", "Tightened", "4.0", "H", 50, 3, 4));
  it("row S sample size is 3150", () => expect(SAMPLE_SIZES["S"]).toBe(3150));
});

describe("Table II-C (Reduced)", () => {
  it("H@1.0 -> n20 Ac0/Re2", () => check(500, "II", "Reduced", "1.0", "H", 20, 0, 2));
  it("F@1.0 -> up arrow to E, n5 Ac0/Re1", () => check(120, "II", "Reduced", "1.0", "E", 5, 0, 1));
  it("K@1.0 -> n50 Ac1/Re4", () => check(2000, "II", "Reduced", "1.0", "K", 50, 1, 4));
  it("H@4.0 -> n20 Ac2/Re5", () => check(500, "II", "Reduced", "4.0", "H", 20, 2, 5));
  it("uses reduced sample sizes", () => {
    expect(REDUCED_SAMPLE_SIZES["H"]).toBe(20);
    expect(REDUCED_SAMPLE_SIZES["R"]).toBe(800);
  });
});

describe("every Table I letter resolves to a real plan", () => {
  it("no arrow dead-ends for any letter, AQL and severity", () => {
    const lots = [5, 12, 20, 40, 70, 120, 200, 400, 1000, 2000, 5000, 20000, 100000, 300000, 600000];
    for (const lot of lots) for (const level of ["II", "III"] as const)
      for (const sev of ["Normal", "Tightened", "Reduced"] as const)
        for (const aql of AQL_VALUES) {
          const r = aqlLookup(lot, level, sev, aql);
          expect(r.re).toBeGreaterThan(r.ac);
        }
  });
});

describe("critical characteristics always Ac0/Re1", () => {
  it("ignores the table for critical", () => {
    for (const sev of ["Normal", "Tightened", "Reduced"] as const) {
      const r = aqlLookup(500, "II", sev, "4.0", true);
      expect([r.ac, r.re]).toEqual([0, 1]);
    }
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
