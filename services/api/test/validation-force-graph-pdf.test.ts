import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { downsample, graphFromData, niceTicks, FORCE_GRAPH_SPECS } from "../src/modules/validation-reports/forceGraphPdf.js";
import { renderValidationReportPdf } from "../src/modules/validation-reports/validationReportPdf.js";
import { pdfDrawnText as pdfText } from "./helpers/pdfText.js";

const run = (n: number) => Array.from({ length: n }, (_, i) => [i * 0.025, 180 + 4.2 * i * 0.025] as [number, number]);

describe("force graph in downloaded validation PDFs", () => {
  it("picks the same axis ticks as the screen chart", () => {
    expect(niceTicks(0, 60)).toEqual([0, 15, 30, 45, 60]);
    expect(niceTicks(180, 440)).toEqual([150, 225, 300, 375, 450]);
    expect(niceTicks(360, 576)).toHaveLength(5);
    expect(niceTicks(5, 5)).toHaveLength(5);
  });

  it("reads the saved points the way the app does and thins long runs the same way", () => {
    const g = graphFromData({ graph: { fields: { File: "a.csv", Rate: 4.2 }, points: [[1, 2], ["x", 3], [3, 4], [Number.NaN, 1]] } });
    expect(g).toEqual({ fields: { File: "a.csv", Rate: "4.2" }, points: [[1, 2], [3, 4]] });
    const thin = downsample(run(2400));
    expect(thin).toHaveLength(1500);
    expect(thin[0]).toEqual([0, 180]);
    expect(thin.at(-1)).toEqual(run(2400).at(-1));
  });

  it("draws the chart for every form that records force points, and not for forms without them", async () => {
    expect(Object.keys(FORCE_GRAPH_SPECS).sort()).toEqual(["electric_lift", "regular_gas_lift"]);
    for (const formType of Object.keys(FORCE_GRAPH_SPECS)) {
      const bytes = await renderValidationReportPdf({ formType, cells: { B6: "PN-1" }, graph: { fields: { File: "run.csv" }, points: run(2400) } }, "AccuQual");
      const text = await pdfText(bytes);
      expect(text).toContain("Force Graph");
      expect(text).toContain(FORCE_GRAPH_SPECS[formType]!.title);
      expect(text).toContain("Displacement (mm)");
      expect(text).toContain("run.csv");
      expect(text).toContain("2,400 points; the chart shows 1,500 of them.");
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    }
    const empty = await pdfText(await renderValidationReportPdf({ formType: "electric_lift", cells: {} }, "AccuQual"));
    expect(empty).toContain("No points recorded.");
    const csa = await pdfText(await renderValidationReportPdf({ formType: "csa", cells: { B6: "CSA-1" } }, "AccuQual"));
    expect(csa).not.toContain("Force Graph");
  });
});
