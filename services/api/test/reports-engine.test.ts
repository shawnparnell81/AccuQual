import { describe, expect, it } from "vitest";
import { AppError } from "../src/utils/appError.js";
import { ReportExportService } from "../src/modules/reports/ReportExportService.js";
import { renderQualityReportPdf } from "../src/modules/reports/reportPdf.js";
import { pdfVisibleText } from "../src/modules/forms/controlledPdf.js";
import { ReportTemplateService } from "../src/modules/reports/ReportTemplateService.js";
import { reportScheduleStub } from "../src/modules/reports/reports.scheduler.js";
import {
  agingLabel,
  emptySection,
  reportToCsv,
  resolvePlant,
  resolveRange,
  sectionAllows,
  tablesReady,
  templateFor,
  type QualityReport,
  type SectionSpec,
} from "../src/modules/reports/reports.model.js";

const NOW = new Date("2026-10-01T15:00:00.000Z");

describe("report templates", () => {
  it("versions the weekly and monthly section lists", () => {
    const document = ReportTemplateService.list();
    expect(document.version).toBe(1);
    const weekly = document.templates.find((template) => template.key === "weekly");
    const monthly = document.templates.find((template) => template.key === "monthly");
    expect(weekly?.header).toEqual(["type", "dateRange", "plant", "generatedAt", "generatedBy"]);
    expect(weekly?.sections.map((section) => section.key)).toEqual([
      "ncr",
      "capa",
      "issue_trend",
      "aging",
      "plant_comparison",
      "supplier",
      "receiving",
      "audit_trail",
      "engineering_changes",
      "document_activity",
    ]);
    expect(monthly?.sections.map((section) => section.key)).toEqual([
      ...weekly!.sections.map((section) => section.key),
      "training",
      "calibration",
      "ppap",
      "workflow_cycle_times",
    ]);
    expect(ReportTemplateService.get("adhoc")?.sections).toHaveLength(14);
    expect(ReportTemplateService.get("nope")).toBeNull();
  });

  it("skips a section whose table is missing and hides one the person cannot read", () => {
    const spec = templateFor("weekly").find((item) => item.key === "ncr") as SectionSpec;
    expect(tablesReady(spec, new Set(["ncr"]))).toBe(true);
    expect(tablesReady(spec, new Set())).toBe(false);
    expect(sectionAllows(spec, () => false, true)).toBe(false);
    expect(sectionAllows(spec, (resource) => resource === "ncr", false)).toBe(true);
    const skipped = emptySection(spec, "skipped", "This section was skipped because a table it needs is not in the database.");
    expect(skipped.status).toBe("skipped");
    expect(skipped.summary).toEqual({});
  });
});

describe("report dates and plants", () => {
  it("uses a 7-day week and the month so far, and requires custom dates", () => {
    const week = resolveRange("weekly", undefined, undefined, NOW);
    expect(week.from.toISOString()).toBe("2026-09-25T00:00:00.000Z");
    expect(week.to.toISOString()).toBe("2026-10-01T23:59:59.999Z");
    const month = resolveRange("monthly", undefined, undefined, NOW);
    expect(month.from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(() => resolveRange("adhoc", undefined, undefined, NOW)).toThrow(AppError);
    const custom = resolveRange("adhoc", "2026-01-02", "2026-01-04", NOW);
    expect(custom.from.toISOString()).toBe("2026-01-02T00:00:00.000Z");
    expect(custom.to.toISOString()).toBe("2026-01-04T23:59:59.999Z");
  });

  it("keeps a plant the person is not assigned to out of the report", () => {
    expect(() =>
      resolvePlant({ plantId: 9, allowedSiteIds: [1], currentSiteId: 1, sites: [{ id: 1, name: "Dayton" }] }),
    ).toThrow(AppError);
    expect(resolvePlant({ plantId: "all", allowedSiteIds: [1, 2], currentSiteId: 1, sites: [{ id: 1, name: "Dayton" }] }).plant).toEqual({
      id: null,
      name: "All plants",
      scope: "all",
    });
    expect(resolvePlant({ plantId: undefined, allowedSiteIds: [1], currentSiteId: 1, sites: [{ id: 1, name: "Dayton" }] }).siteIds).toEqual([1]);
  });

  it("puts open work into the same aging bands as the dashboard", () => {
    expect(agingLabel(0)).toBe("0–7d");
    expect(agingLabel(7)).toBe("0–7d");
    expect(agingLabel(8)).toBe("8–30d");
    expect(agingLabel(31)).toBe("31–60d");
    expect(agingLabel(61)).toBe("60d+");
  });
});

describe("report export", () => {
  const report: QualityReport = {
    header: {
      templateVersion: 1,
      templateKey: "weekly",
      type: "weekly",
      title: "Weekly quality report",
      dateRange: { from: "2026-09-25T00:00:00.000Z", to: "2026-10-01T23:59:59.999Z" },
      plant: { id: 1, name: "Dayton, OH", scope: "plant" },
      generatedAt: "2026-10-01T15:00:00.000Z",
      generatedBy: { id: 4, name: "Shawn" },
    },
    sections: [
      { key: "ncr", title: "NCR", status: "ok", summary: { opened: 2 }, rows: [{ label: "Opened · open", value: 2 }] },
      { key: "capa", title: "CAPA", status: "skipped", reason: "missing table", summary: {}, rows: [] },
    ],
    delivery: {
      pdf: { status: "stub", message: "PDF export is not available yet. Download CSV or JSON." },
      email: { status: "stub", message: "Scheduled email is not turned on. Run a report here and download CSV or JSON." },
    },
  };

  it("writes a CSV with the header and a skipped section, and a PDF of the same report", async () => {
    const csv = reportToCsv(report);
    expect(csv).toContain("# Weekly quality report");
    expect(csv).toContain("# Plant: Dayton, OH");
    expect(csv).toContain("# Generated: 2026-10-01T15:00:00.000Z by Shawn");
    expect(csv).toContain("ncr,NCR,ok,opened,2");
    expect(csv).toContain('capa,CAPA,skipped,reason,missing table');
    expect(ReportExportService.csv(report).fileName).toMatch(/^accuqual-weekly-report-/);
    expect(ReportExportService.json(report).body).toContain('"templateVersion": 1');
    const pdf = await renderQualityReportPdf(report);
    const text = await pdfVisibleText(pdf);
    expect(text).toContain("Weekly quality report");
    expect(text).toContain("Opened");
    expect(text).toContain("missing table");
    expect(reportScheduleStub().enabled).toBe(false);
  });
});
