import { describe, expect, it } from "vitest";
import { dimensionalReportLayout } from "../src/modules/forms/layouts/dimensionalReport.js";
import { renderFormLayoutAsPdf } from "../src/modules/forms/schema-pdf-renderer.js";
import {
  applyMeasuredResult,
  faiResult,
  measuredCellValue,
  passFailPdfPalette,
} from "../src/utils/passFail.js";

describe("pass/fail from nominal, tolerance, and actual", () => {
  it("passes inside the band and fails outside it", () => {
    expect(faiResult(10, 0.1, 10.05)).toBe("Pass");
    expect(faiResult(10, 0.1, 10.2)).toBe("Fail");
    expect(faiResult(10, "±0.05", 10.05)).toBe("Pass");
    expect(faiResult(10, "±0.05", 10.06)).toBe("Fail");
    expect(faiResult(10, "", 10)).toBe("");
    expect(passFailPdfPalette("Pass")?.bg[1]).toBeGreaterThan(passFailPdfPalette("Pass")?.bg[0] ?? 0);
    expect(passFailPdfPalette("Fail")?.bg[0]).toBe(1);
    expect(passFailPdfPalette("")).toBeNull();
  });

  it("overwrites a typed inspection result when min, max, and actual decide it", () => {
    expect(applyMeasuredResult({ specMin: "9.9", specMax: "10.1", actualValue: "10.4" }, { result: "pass" }).result).toBe("fail");
    expect(applyMeasuredResult({}, { specMin: 1, specMax: 2, actualValue: 1.5, result: "fail" }).result).toBe("pass");
    expect(applyMeasuredResult({}, { actualFinding: "No defects observed", result: "pass" }).result).toBe("pass");
  });

  it("prints a dimensional row with the calculated word", async () => {
    const row = { nominal: "10", tolerance: "0.1", actual: "10.2" };
    expect(measuredCellValue("dimensionalPassFail", row, "Pass")).toBe("Fail");
    const bytes = await renderFormLayoutAsPdf(dimensionalReportLayout, { dimensions: [row] });
    expect(Buffer.from(bytes.slice(0, 5)).toString("ascii")).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
