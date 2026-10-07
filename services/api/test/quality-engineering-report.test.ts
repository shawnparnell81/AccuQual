import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { pdfVisibleText } from "../src/modules/forms/controlledPdf.js";
import {
  assembleReport,
  emptyLive,
  emptyNarrative,
  emptySupplierData,
  mergeUploadNarrative,
  monthWindow,
} from "../src/modules/quality-engineering-report/model.js";
import { renderEngineeringReportPdf } from "../src/modules/quality-engineering-report/pdf.js";
import { readSupplierTemplate, supplierTemplateFile } from "../src/modules/quality-engineering-report/service.js";
import { parseSupplierFile } from "../src/modules/quality-engineering-report/supplierParse.js";
import { saveEngineeringReportSchema } from "../src/modules/quality-engineering-report/validation.js";
import { AppError } from "../src/utils/appError.js";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const samplePath = join(dirname(fileURLToPath(import.meta.url)), "../src/modules/quality-engineering-report/sample/quality-engineering-supplier-august-2026.csv");

describe("quality engineering supplier upload", () => {
  it("fills August charts and tables from the sample file and does not invent claims from NCR", async () => {
    const downloaded = supplierTemplateFile();
    expect(downloaded.fileName).toBe("quality-engineering-supplier-august-2026.csv");
    expect(downloaded.body.equals(readFileSync(samplePath))).toBe(true);
    const parsed = await parseSupplierFile(downloaded.body, downloaded.fileName, 2026);
    expect(parsed.warnings).toEqual([]);
    const augustClaims = parsed.data.monthlyMetrics.find((row) => row.month === "2026-08");
    expect(augustClaims).toMatchObject({ totalClaims: 459, totalProductAlerts: 19 });
    expect(parsed.data.financials.find((row) => row.month === "2026-08")?.totalAmount).toBe(108871.03);
    expect(parsed.data.topParts[0]).toMatchObject({ partNumber: "A60076", totalClaims: 9 });
    expect(parsed.data.fuelPumpReturns).toEqual([
      { source: "DMA Parts", count: 150 },
      { source: "Carter Pumps", count: 76 },
    ]);
    expect(parsed.data.faiCategories.find((row) => row.category === "Fuel & Lift Supports")).toMatchObject({ passed: 216, failed: 134, passedWithDeviation: 19 });
    expect(parsed.data.warrantyMetrics.find((row) => row.month === "2026-04")?.medianDays).toBeNull();
    expect(parsed.data.warrantyMetrics.find((row) => row.month === "2026-08")).toMatchObject({ mttfDays: 125.9, medianDays: 41, laborToPartsRatio: "6.76:1" });
    expect(parsed.data.topVehicles[0]).toMatchObject({ vehicle: "Chevrolet Silverado 1500", claims: 28 });

    const narrative = mergeUploadNarrative(emptyNarrative(), parsed.data, false);
    expect(narrative.departmentStatus).toBe("yellow");
    expect(narrative.primaryAchievement).toContain("314");
    expect(narrative.techLine).toHaveLength(2);
    expect(narrative.techLine[0]?.response).toContain("B0086P");

    const live = emptyLive();
    live.ncr = { status: "ok", data: { total: 11, open: 9, closed: 2, rows: [] } };
    const view = assembleReport({
      year: 2026,
      month: 8,
      narrative,
      supplier: parsed.data,
      live,
      saved: true,
      uploadFileName: "sample.csv",
      canEdit: true,
    });
    expect(view.executive.rawClaimCount).toBe(459);
    expect(view.executive.rawClaimCount).not.toBe(11);
    expect(view.tables.metrics.totalClaims).toEqual([335, 546, 439, 416, 425, 459]);
    expect(view.tables.fai.source).toBe("supplier");
    expect(view.tables.fai.rows.at(-1)).toMatchObject({ category: "Total", totalCompleted: 411, passed: 231, failed: 161 });
    expect(view.charts.claimsSeriesScope).toBe("month");
    expect(view.charts.claimsReturns.length).toBeGreaterThan(0);
    expect(view.charts.fuelPumpReturns).toHaveLength(2);
    expect(view.charts.topVehicles[0]?.vehicle).toContain("Silverado");
    expect(view.charts.emailIssues.find((row) => row.month === "2026-08")?.totalIssues).toBe(42);
    expect(view.labor).toEqual({ mttfDays: 125.9, medianDays: 41 });
    expect(view.live.ncr).toMatchObject({ status: "ok", data: { total: 11 } });

    const blank = assembleReport({
      year: 2026,
      month: 8,
      narrative: emptyNarrative(),
      supplier: emptySupplierData(),
      live,
      saved: false,
      uploadFileName: null,
      canEdit: true,
    });
    expect(blank.executive.rawClaimCount).toBeNull();
    expect(blank.tables.metrics.totalClaims.every((value) => value == null)).toBe(true);
    expect(blank.charts.claimsSeriesScope).toBe("empty");
    expect(monthWindow(2026, 8)).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);

    expect(saveEngineeringReportSchema.parse({ year: 2026, month: 8, narrative })).toMatchObject({
      year: 2026,
      month: 8,
      narrative: { departmentStatus: "yellow" },
    });

    const pdf = await renderEngineeringReportPdf(view, null);
    const text = await pdfVisibleText(pdf);
    expect(text).toContain("459");
    expect(text).toContain("A60076");
    expect(text).toContain("108,871.03");
    expect(text).toContain("DMA Parts");
    expect(text).toContain("YELLOW");
    expect(text).toContain("B0086P");
  });

  it("reads an Excel workbook that uses one sheet per dataset", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("monthly_metrics");
    sheet.addRow(["month", "total_claims", "total_product_alerts"]);
    sheet.addRow(["2026-08", 12, 3]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsed = await parseSupplierFile(buffer, "supplier.xlsx", 2026);
    expect(parsed.data.monthlyMetrics).toEqual([{ month: "2026-08", totalClaims: 12, totalProductAlerts: 3 }]);
    expect(parsed.data.fuelPumpReturns).toEqual([]);
  });
});

describe("quality engineering sample download", () => {
  it("names a missing build file in plain language instead of a reference id", () => {
    expect(() => readSupplierTemplate(join(apiRoot, "dist/no-such-engineering-sample.csv"))).toThrow(AppError);
    try {
      readSupplierTemplate(join(apiRoot, "dist/no-such-engineering-sample.csv"));
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const error = err as AppError;
      expect(error.statusCode).toBe(500);
      expect(error.message).toBe("The sample supplier CSV is not included in this server build.");
      expect(error.message).not.toMatch(/ENOENT|reference/i);
    }
  });

  it("returns the August 2026 CSV from the compiled API bundle", () => {
    const sampleDir = join(apiRoot, "dist/modules/quality-engineering-report/sample");
    rmSync(sampleDir, { recursive: true, force: true });
    run("npm", ["run", "build"]);
    expect(run(process.execPath, ["test/compiled-engineering-sample.mjs"], testEnv()).trim()).toBe("ok");

    rmSync(join(sampleDir, "quality-engineering-supplier-august-2026.csv"), { force: true });
    expect(run(process.execPath, ["test/compiled-engineering-sample.mjs", "--missing"], testEnv()).trim()).toBe("ok");
    run(process.execPath, ["scripts/copy-module-assets.mjs"]);
  }, 180_000);
});

function testEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgres://test:test@localhost:5432/accuqual_test",
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? "test-access-secret",
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret",
  };
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
  try {
    return execFileSync(command, args, {
      cwd: apiRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 170_000,
      env,
    });
  } catch (err) {
    const failed = err as { stdout?: string; stderr?: string; message?: string };
    throw new Error(`${command} ${args.join(" ")} failed\n${failed.stdout ?? ""}\n${failed.stderr ?? ""}\n${failed.message ?? ""}`);
  }
}
