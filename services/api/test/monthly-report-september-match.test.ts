import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractFileWithImages } from "../src/modules/form-import/extract.js";
import { proposeMonthlyQuality, toSupplierData } from "../src/modules/form-import/reportTargets/monthlyQuality.js";
import { assembleReport, currentImageSectionKey, emptyLive, emptyNarrative, mergeUploadNarrative, sectionKeyForHeading } from "../src/modules/quality-engineering-report/model.js";
import { importedMonthTotals } from "../src/modules/quality-engineering-report/importMonths.js";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "monthly-quality-report-september-2026.docx");

async function september() {
  const extracted = await extractFileWithImages(readFileSync(fixture), "september.docx");
  const { proposals } = proposeMonthlyQuality(extracted.file);
  const supplier = toSupplierData(Object.fromEntries(proposals.map((proposal) => [proposal.key, proposal.value])) as never, 2026, 9);
  const narrative = mergeUploadNarrative(emptyNarrative(), supplier, true);
  const view = assembleReport({ year: 2026, month: 9, narrative, supplier, live: emptyLive(), saved: true, uploadFileName: "september.docx", canEdit: true });
  return { extracted, view };
}

describe("DMA September 2026 report comes out the same in AccuQual", () => {
  it("fills all three trend tables with the report's own numbers", async () => {
    const { view } = await september();
    expect(view.tables.months.map((month) => month.key)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(view.tables.metrics.totalClaims).toEqual([546, 439, 416, 425, 459, 461]);
    expect(view.tables.metrics.totalProductAlerts).toEqual([27, 20, 22, 20, 19, 28]);
    expect(view.tables.financials.total).toEqual([114542.01, 92988.15, 101480.45, 99968.98, 108871.03, 108492.22]);
    expect(view.tables.financials.parts).toEqual([10154.9, 3933.79, 8882.25, 9763.74, 14028.27, 10529.32]);
    expect(view.tables.financials.labor).toEqual([81794.55, 92988.15, 92598.2, 90205.24, 94842.76, 97962.9]);
    expect(view.tables.warranty.ratio).toEqual(["8.05:1", "23.6:1", "10.4:1", "9.2:1", "6.76:1", "9.30:1"]);
    expect(view.tables.warranty.mttfDays).toEqual([126.2, 105.5, 140.9, 128.5, 125.9, 122.7]);
    expect(view.tables.warranty.medianDays).toEqual([null, null, 65, 58, 41, 42]);
  });

  it("fills the executive summary, NCR table, free-text sections and picture placement", async () => {
    const { view, extracted } = await september();
    expect(view.executive).toMatchObject({ departmentStatus: "yellow", rawClaimCount: 461, trackerProcessed: 220, totalAmountRequested: 108492.22, partsAmountRequested: 10529.32, laborAmountRequested: 97962.9, potentialLiability: 34575, flatRate: 75 });
    expect(view.sections.ncrTableRows).toEqual([
      { ncrNumber: "NCR-2026-065", partNumber: "CS5477", description: "P3 Slightly out of spec", disposition: "Use-As-Is", status: "Closed" },
      { ncrNumber: "NCR-2026-066", partNumber: "[Unassigned]", description: "Hardware ungraded", disposition: "Use-As-Is", status: "Open" },
    ]);
    expect(view.sections.fitment).toHaveLength(1);
    expect(view.sections.fitment[0]!.response).toMatch(/catalog issue/i);
    expect(view.sections.productInfo).toHaveLength(2);
    expect(view.tables.topParts).toHaveLength(10);
    expect(view.tables.fai.rows.at(-1)).toMatchObject({ category: "Total", totalCompleted: 407, passed: 229, failed: 160, passedWithDeviation: 18 });
    // Four pictures, placed under the same numbered sections as DMA's report (6.9 is OR/NAPA Email Issues).
    expect(extracted.images.map((image) => sectionKeyForHeading(image.section))).toEqual(["6.2", "6.2", "6.2", "6.9"]);
  });

  it("re-places an older saved picture by its Word heading after the renumbering", () => {
    expect(currentImageSectionKey("6.9 - OR/NAPA Email Issues", "6.10")).toBe("6.9");
    expect(currentImageSectionKey("6.11 - Fitment Verification", "6.12")).toBe("6.11");
    expect(currentImageSectionKey(null, "6.2")).toBe("6.2");
  });

  it("puts trend months from a January report's header in the year before", () => {
    const supplier = toSupplierData({ monthly_metrics: [["Metric", "August", "January"], ["Total Claims", "10", "20"]] } as never, 2027, 1);
    expect(supplier.monthlyMetrics).toEqual([
      { month: "2026-08", totalClaims: 10, totalProductAlerts: null },
      { month: "2027-01", totalClaims: 20, totalProductAlerts: null },
    ]);
  });
});

describe("imported datasets feed the trend tables by month", () => {
  const sources = [
    {
      importId: 7,
      displayName: "O'Reilly YTD",
      typeLabel: "Retailer report",
      rows: [
        { mapped: { report_date: "2026-08-03", labor_amount: "$1,000.50", returns_count: "2" } },
        { mapped: { report_date: "8/20/2026", labor_amount: "499.50", returns_count: "1" } },
        { mapped: { report_date: "2026-09-01", labor_amount: "300", returns_count: "4" } },
        { mapped: { report_date: "2025-01-01", labor_amount: "999999" } },
        { mapped: { labor_amount: "50" } },
      ],
    },
  ];
  const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  it("splits by Report date, leaves undated rows out (no guessing into the report month), and drops months outside the window", () => {
    const totals = importedMonthTotals(
      [
        { importId: 7, section: "labor", field: "labor_amount" },
        { importId: 7, section: "returns", field: "returns_count" },
      ],
      sources,
      months,
      "2026-09",
    );
    expect(totals["2026-08"]).toEqual({ total: null, parts: null, labor: 1500, claims: 3 });
    expect(totals["2026-09"]).toEqual({ total: null, parts: null, labor: 300, claims: 4 });
    expect(Object.keys(totals).sort()).toEqual(["2026-08", "2026-09"]);
  });

  it("shows the imported figures in the money table when the report has none", () => {
    const view = assembleReport({
      year: 2026,
      month: 9,
      narrative: emptyNarrative(),
      supplier: { ...toSupplierData({} as never, 2026, 9) },
      live: emptyLive(),
      saved: true,
      uploadFileName: null,
      canEdit: true,
      importedMonths: { "2026-09": { total: null, parts: 50, labor: 350, claims: 4 } },
    });
    expect(view.tables.financials.labor.at(-1)).toBe(350);
    expect(view.tables.financials.laborSource.at(-1)).toBe("imported");
    expect(view.tables.financials.total.at(-1)).toBe(400);
    expect(view.tables.metrics.totalClaims.at(-1)).toBe(4);
  });
});
