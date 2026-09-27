import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { getFormLayout } from "../src/modules/forms/layouts/index.js";
import { parseApqpSummaryData } from "../src/modules/forms/apqpSummary.validation.js";
import { renderFormLayoutAsPdf } from "../src/modules/forms/schema-pdf-renderer.js";
import type { FormLayout, TableBlock } from "../src/modules/forms/layouts/types.js";

function table(layout: FormLayout, name: string): TableBlock {
  for (const section of layout.sections) {
    for (const block of section.blocks) {
      if (block.type === "table" && block.name === name) return block;
    }
  }
  throw new Error(`missing table ${name}`);
}

const prose = {
  required: "Yes — all special characteristics identified on the drawing",
  acceptable: "Acceptable except OD; see note",
  pending: "Pending MSA study, due before SOP",
};

describe("APQP summary free-text fields", () => {
  const layout = getFormLayout("apqp_summary")!;

  it("keeps the form shape and treats status notes as text", () => {
    expect(layout.formType).toBe("apqp_summary");
    expect(layout.sections.map((section) => section.title)).toEqual([
      "GENERAL INFORMATION",
      "PRELIMINARY PROCESS CAPABILITY STUDY",
      "CONTROL PLAN APPROVAL (IF REQUIRED)",
      "INITIAL PRODUCTION SAMPLES",
      "GAGE AND TEST EQUIPMENT — MEASUREMENT SYSTEM ANALYSIS",
      "PROCESS MONITORING",
      "PACKAGING / SHIPPING",
      "SIGN-OFF",
    ]);

    for (const name of ["processCapability", "gageTestEquipment", "processMonitoring", "packagingShipping"]) {
      expect(table(layout, name).columns.map((column) => [column.key, column.label, column.kind])).toEqual([
        ["required", "Required", "text"],
        ["acceptable", "Acceptable", "text"],
        ["pending", "Pending*", "text"],
      ]);
    }

    expect(table(layout, "initialProductionSamples").columns.map((column) => [column.key, column.label, column.kind])).toEqual([
      ["samples", "Samples", "number"],
      ["characteristics", "Characteristics", "text"],
      ["acceptable", "Acceptable", "text"],
    ]);

    expect(table(layout, "signoffs").columns.map((column) => [column.key, column.label, column.kind])).toEqual([
      ["teamMember", "Team Member / Title", "text"],
      ["date", "Date", "date"],
    ]);
  });

  it("accepts descriptive text in every status cell and stores it as text", () => {
    const parsed = parseApqpSummaryData({
      productName: "Brake bracket, rev C",
      partNumber: "BB-4410-C",
      customer: "Northwind Automotive",
      manufacturingPlant: "Plant 2 — Dayton",
      date: "2026-09-01",
      processCapability: [prose],
      controlPlanApproved: "Yes",
      controlPlanApprovedDate: "2026-09-02",
      initialProductionSamples: [
        { samples: 5, characteristics: "OD, length, and wall thickness", acceptable: "Pass with comments on OD" },
        { samples: "", characteristics: "Visual: scratches, color", acceptable: "N/A — appearance report covers this" },
      ],
      gageTestEquipment: [{ ...prose, pending: "2 gages still in calibration" }],
      processMonitoring: [
        { required: "Work instructions posted at each station", acceptable: "Current rev on file", pending: "None" },
      ],
      packagingShipping: [{ required: "Customer packaging spec PS-19", acceptable: "Trial shipment accepted", pending: "Label artwork pending" }],
      signoffs: [{ teamMember: "Ada Lovelace, Quality Engineer", date: "2026-09-03" }],
    });

    expect(parsed.productName).toBe("Brake bracket, rev C");
    expect(parsed.processCapability?.[0]?.pending).toBe("Pending MSA study, due before SOP");
    expect(parsed.initialProductionSamples?.[0]?.characteristics).toBe("OD, length, and wall thickness");
    expect(parsed.initialProductionSamples?.[0]?.acceptable).toBe("Pass with comments on OD");
    expect(parsed.initialProductionSamples?.[0]?.samples).toBe(5);
    expect(parsed.initialProductionSamples?.[1]?.samples).toBe("");
    expect(parsed.signoffs?.[0]?.teamMember).toBe("Ada Lovelace, Quality Engineer");
    expect(parsed.packagingShipping?.[0]?.pending).toBe("Label artwork pending");
  });

  it("keeps a previously stored count when an old numeric status cell is saved again", () => {
    const parsed = parseApqpSummaryData({
      processCapability: [{ required: 8, acceptable: 6, pending: 2 }],
    });
    expect(parsed.processCapability?.[0]).toEqual({ required: "8", acceptable: "6", pending: "2" });
  });

  it("still requires the sample count to be numeric", () => {
    expect(() =>
      parseApqpSummaryData({
        initialProductionSamples: [{ samples: "five pieces", characteristics: "OD", acceptable: "Yes" }],
      }),
    ).toThrow(ZodError);

    const parsed = parseApqpSummaryData({
      initialProductionSamples: [{ samples: "12", characteristics: "threads", acceptable: "Yes" }],
    });
    expect(parsed.initialProductionSamples?.[0]?.samples).toBe(12);
  });

  it("renders a PDF when status cells contain prose", async () => {
    const bytes = await renderFormLayoutAsPdf(layout, {
      productName: "Brake bracket",
      processCapability: [{ required: "Complete", acceptable: "1.67 Ppk minimum met", pending: "None open" }],
      initialProductionSamples: [{ samples: 5, characteristics: "OD and length", acceptable: "Acceptable" }],
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString("ascii")).toBe("%PDF-");
  });
});
