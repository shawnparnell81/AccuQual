import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { FormLayout } from "../src/modules/forms/layouts/types.js";
import { renderFormLayoutAsPdf } from "../src/modules/forms/schema-pdf-renderer.js";
import { classificationForStatus, emptyFrame, exportTrace, pdfVisibleText, watermarkForStatus } from "../src/modules/forms/controlledPdf.js";
import { renderFaiPdf } from "../src/modules/fai/fai.pdf.js";

const layout: FormLayout = {
  formType: "ncr",
  title: "Nonconformance",
  sections: [
    {
      number: "1",
      title: "Record",
      blocks: [{ type: "row", fields: [{ kind: "text", name: "containment", label: "Containment Action" }] }],
    },
    {
      number: "2",
      title: "Approval",
      blocks: [{ type: "row", fields: [{ kind: "text", name: "signer", label: "Signed by" }] }],
    },
  ],
};

describe("controlled pdf", () => {
  it("prints the entered value, identity, watermark, and checksum metadata", async () => {
    const frame = emptyFrame({
      sourceModule: "NCR",
      recordNumber: "NCR-15",
      revision: "B",
      generatedBy: "Shawn",
      status: "draft",
      exportId: "exp_test",
      generatedAt: new Date("2026-10-04T12:00:00.000Z"),
      approvals: [{ name: "Shawn", role: "Quality", action: "Approved", at: "2026-10-04", status: "Approved" }],
      audit: [{ who: "Shawn", action: "status_change", at: "2026-10-04 12:00:00 UTC", reason: "Lot held" }],
      attachments: [{ name: "photo.png", type: "image/png", size: "12 bytes", uploadedBy: "Shawn", uploadedAt: "2026-10-04" }],
    });
    const bytes = await renderFormLayoutAsPdf(layout, { containment: "Quarantine the lot", signer: "Shawn" }, frame);
    const text = await pdfVisibleText(bytes);
    expect(text).toContain("Quarantine the lot");
    expect(text).toContain("NCR-15");
    expect(text).toContain("DRAFT");
    expect(text).toContain("Electronically Approved");
    expect(text).toContain("Lot held");
    expect(text).toContain("photo.png");
    expect(text).not.toContain("/attachments/");
    expect(watermarkForStatus("draft")).toBe("DRAFT");
    expect(classificationForStatus("obsolete")).toBe("OBSOLETE");
    expect(watermarkForStatus("confidential")).toBeNull();
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toContain("NCR-15");
    expect(doc.getAuthor()).toBe("Shawn");
    const trace = exportTrace(bytes, frame);
    expect(trace.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(trace.mime).toBe("application/pdf");
    expect(trace.exportId).toBe("exp_test");
  });

  it("repeats page numbers when a table crosses a page", async () => {
    const wide: FormLayout = {
      formType: "inspection",
      title: "Inspection",
      sections: [
        {
          number: "1",
          title: "Results",
          blocks: [
            {
              type: "table",
              name: "rows",
              columns: Array.from({ length: 8 }, (_, index) => ({ key: `c${index}`, label: `Col ${index}`, kind: "text" as const })),
            },
          ],
        },
      ],
    };
    const rows = Array.from({ length: 40 }, (_, index) => {
      const row: Record<string, string> = {};
      for (let column = 0; column < 8; column += 1) row[`c${column}`] = `R${index}C${column}`;
      return row;
    });
    const frame = emptyFrame({ sourceModule: "FAI", recordNumber: "FAI-1", revision: "1", generatedBy: "Shawn", exportId: "exp_pages" });
    const bytes = await renderFormLayoutAsPdf(wide, { rows }, frame);
    const text = await pdfVisibleText(bytes);
    const doc = await PDFDocument.load(bytes);
    const pages = doc.getPageCount();
    expect(pages).toBeGreaterThan(1);
    expect(text).toContain(`1 of ${pages}`);
    expect(text).toContain(`${pages} of ${pages}`);
    expect(text.split("Col 0").length - 1).toBeGreaterThanOrEqual(pages);
    expect(text).toContain("R0C0");
    expect(text).toContain("R39C0");
  });

  it("keeps first-article characteristic columns and leaves a missing signature off the page", async () => {
    const bytes = await renderFaiPdf({
      number: "FAI-9",
      partNumber: "PN-1",
      partName: "Bracket",
      supplierName: "Acme",
      planName: "Plan",
      planRevision: 2,
      outcome: "open",
      comments: null,
      qualitySignature: null,
      decidedOn: null,
      ncrNumber: null,
      lines: [
        {
          balloon: "25",
          name: "Hole",
          mode: "variable",
          nominal: "10",
          percent: null,
          plusTolerance: "0.1",
          minusTolerance: "0.1",
          limitLow: "9.9",
          limitHigh: "10.1",
          actual: "10.0",
          attributeResult: null,
          result: "pass",
        },
      ],
    });
    const text = await pdfVisibleText(bytes);
    expect(text).toContain("Balloon");
    expect(text).toContain("Characteristic");
    expect(text).toContain("Limits");
    expect(text).toContain("Pass/Fail");
    expect(text).toContain("Hole");
    expect(text).toContain("10.0");
    expect(text).not.toContain("Electronically Approved");
  });
});
