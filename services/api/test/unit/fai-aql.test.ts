import { describe, expect, it } from "vitest";
import { aqlLookup, codeLetterFor, lotResult, SAMPLE_SIZES } from "../../src/modules/fai-inspection/aql.js";

describe("Z1.4 code letter lookup (Table 1)", () => {
  it("lot 150, level II -> F", () => {
    expect(codeLetterFor(150, "II")).toBe("F");
  });
  it("lot 1200, level II -> J", () => {
    expect(codeLetterFor(1200, "II")).toBe("J");
  });
  it("lot 35, level I -> C", () => {
    expect(codeLetterFor(35, "I")).toBe("C");
  });
  it("lot 5000, level III -> M", () => {
    expect(codeLetterFor(5000, "III")).toBe("M");
  });
  it("lot 20, level S-2 -> A", () => {
    expect(codeLetterFor(20, "S-2")).toBe("A");
  });
  it("lot 400, level S-4 -> E", () => {
    expect(codeLetterFor(400, "S-4")).toBe("E");
  });
});

describe("Z1.4 sample sizes", () => {
  it("F -> 20, J -> 80, L -> 200", () => {
    expect(SAMPLE_SIZES["F"]).toBe(20);
    expect(SAMPLE_SIZES["J"]).toBe(80);
    expect(SAMPLE_SIZES["L"]).toBe(200);
  });
});

describe("Z1.4 Ac/Re lookup (Table 2-A, Normal)", () => {
  it("lot 150, II, AQL 1.0 -> F, n=20, Ac 3 Re 4", () => {
    const r = aqlLookup(150, "II", "Normal", "1.0");
    expect(r.codeLetter).toBe("F");
    expect(r.sampleSize).toBe(20);
    expect(r.ac).toBe(3);
    expect(r.re).toBe(4);
  });
  it("lot 1200, II, AQL 2.5 -> J, n=80, Ac 21 Re 22", () => {
    const r = aqlLookup(1200, "II", "Normal", "2.5");
    expect(r.codeLetter).toBe("J");
    expect(r.sampleSize).toBe(80);
    expect(r.ac).toBe(21);
    expect(r.re).toBe(22);
  });
  it("lot 500, III, AQL 0.65 -> J, n=80, Ac 10 Re 11", () => {
    const r = aqlLookup(500, "III", "Normal", "0.65");
    expect(r.codeLetter).toBe("J");
    expect(r.ac).toBe(10);
    expect(r.re).toBe(11);
  });
  it("lot 90, I, AQL 4.0 -> C, n=5, Ac 0 Re 1", () => {
    const r = aqlLookup(90, "I", "Normal", "4.0");
    expect(r.codeLetter).toBe("C");
    expect(r.ac).toBe(0);
    expect(r.re).toBe(1);
  });
});

describe("critical characteristics always Ac 0 / Re 1", () => {
  it("ignores the table for critical", () => {
    const r = aqlLookup(5000, "II", "Normal", "1.0", true);
    expect(r.ac).toBe(0);
    expect(r.re).toBe(1);
    expect(r.codeLetter).toBe("L");
  });
});

describe("tightened / reduced shift one AQL column", () => {
  it("tightened is stricter than normal", () => {
    const normal = aqlLookup(150, "II", "Normal", "1.0");
    const tight = aqlLookup(150, "II", "Tightened", "1.0");
    expect(tight.ac).toBeLessThanOrEqual(normal.ac);
  });
  it("reduced is more lenient than normal", () => {
    const normal = aqlLookup(150, "II", "Normal", "1.0");
    const reduced = aqlLookup(150, "II", "Reduced", "1.0");
    expect(reduced.ac).toBeGreaterThanOrEqual(normal.ac);
  });
});

describe("lot result", () => {
  it("fails on any critical defect", () => {
    expect(lotResult({ criticalDefects: 1, majorDefects: 0, minorDefects: 0, reMajor: 3, reMinor: 5 })).toBe("fail");
  });
  it("fails when major defects reach Re", () => {
    expect(lotResult({ criticalDefects: 0, majorDefects: 3, minorDefects: 0, reMajor: 3, reMinor: 5 })).toBe("fail");
  });
  it("fails when minor defects reach Re", () => {
    expect(lotResult({ criticalDefects: 0, majorDefects: 0, minorDefects: 5, reMajor: 3, reMinor: 5 })).toBe("fail");
  });
  it("passes below all Re numbers", () => {
    expect(lotResult({ criticalDefects: 0, majorDefects: 2, minorDefects: 4, reMajor: 3, reMinor: 5 })).toBe("pass");
  });
});
