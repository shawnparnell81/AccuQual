import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import { FigureProvider, hasUnmatchedImages, imagesForSection, NcrReportTable, SectionFigures, type NcrReportRow, type ReportImage } from "./engineeringReportImages";

const ROWS: NcrReportRow[] = [
  { ncrNumber: "NCR-2026-065", partNumber: "CS5477", description: "P3 Slightly out of spec", disposition: "Use-As-Is", status: "Closed" },
  { ncrNumber: "NCR-2026-066", partNumber: "[Unassigned]", description: "Hardware ungraded", disposition: "Use-As-Is", status: "Open" },
];

function image(overrides: Partial<ReportImage>): ReportImage {
  return { attachmentId: 1, section: "6.2 Labor Claims", sectionKey: "6.2", order: 1, caption: "", fileName: "image1.png", ...overrides };
}

describe("NCR table (from report) on the Monthly Quality Report", () => {
  it("renders every imported row exactly as written, with Add row and Delete row for an editor", () => {
    const html = renderToString(<NcrReportTable rows={ROWS} disabled={false} onChange={() => {}} />);
    assert.match(html, /NCR table \(from report\)/);
    for (const text of ["NCR-2026-065", "CS5477", "P3 Slightly out of spec", "NCR-2026-066", "[Unassigned]", "Hardware ungraded", "Closed", "Open"]) {
      assert.ok(html.includes(text), `missing ${text}`);
    }
    assert.match(html, /Add row/);
    assert.equal((html.match(/Delete row/g) ?? []).length, 2);
  });

  it("does not let a read-only viewer add or delete rows", () => {
    const html = renderToString(<NcrReportTable rows={ROWS} disabled onChange={() => {}} />);
    assert.ok(/<button[^>]*disabled[^>]*>Add row/.test(html));
    assert.ok(html.includes("disabled"));
  });

  it("shows an empty message when there are no rows", () => {
    const html = renderToString(<NcrReportTable rows={[]} disabled={false} onChange={() => {}} />);
    assert.match(html, /None yet/);
  });
});

describe("pictures under their sections", () => {
  const images = [
    image({ attachmentId: 1, order: 1, sectionKey: "6.2", caption: "Claims by week" }),
    image({ attachmentId: 2, order: 2, sectionKey: "6.10", section: "6.9 - OR/NAPA Email Issues", caption: "Email issues by month" }),
    image({ attachmentId: 3, order: 3, sectionKey: null, section: "Appendix", caption: "Loose picture" }),
    image({ attachmentId: 4, order: 4, sectionKey: "9.9", section: "Something else", caption: "Unknown section" }),
  ];

  it("matches a picture to the section its heading belongs to", () => {
    assert.deepEqual(imagesForSection(images, "6.2").map((item) => item.attachmentId), [1]);
    assert.deepEqual(imagesForSection(images, "6.10").map((item) => item.attachmentId), [2]);
    assert.deepEqual(imagesForSection(images, "6.6"), []);
  });

  it("puts pictures with no matching section in the Images section, in document order", () => {
    assert.deepEqual(imagesForSection(images, "7").map((item) => item.attachmentId), [3, 4]);
    assert.equal(hasUnmatchedImages(images), true);
    assert.equal(hasUnmatchedImages(images.slice(0, 2)), false);
  });

  it("renders each picture with its caption under it", () => {
    const html = renderToString(
      <FigureProvider value={{ images, canEdit: false, onCaption: () => {}, onDelete: () => {} }}>
        <SectionFigures sectionNumber="6.2" />
        <SectionFigures sectionNumber="7" />
      </FigureProvider>,
    );
    assert.equal((html.match(/<figure/g) ?? []).length, 3);
    for (const caption of ["Claims by week", "Loose picture", "Unknown section"]) assert.ok(html.includes(`<figcaption`) && html.includes(caption), `missing ${caption}`);
    assert.ok(!html.includes("Email issues by month"));
    assert.ok(!html.includes("Delete picture"), "a viewer cannot delete");
  });

  it("gives an editor a caption box and a delete button", () => {
    const html = renderToString(
      <FigureProvider value={{ images, canEdit: true, onCaption: () => {}, onDelete: () => {} }}>
        <SectionFigures sectionNumber="6.2" />
      </FigureProvider>,
    );
    assert.match(html, /Caption for image1\.png/);
    assert.match(html, /Delete picture/);
  });
});

describe("print: pictures and the NCR table", () => {
  const report = readFileSync(new URL("./EngineeringMonthlyReport.tsx", import.meta.url), "utf8");
  const images = readFileSync(new URL("./engineeringReportImages.tsx", import.meta.url), "utf8");

  it("keeps figures and table rows unbroken across pages", () => {
    const style = /@media print \{[^`]*\}/.exec(report)?.[0] ?? "";
    assert.match(style, /\.qe-figure[^{]*\{[^}]*break-inside:\s*avoid/);
    assert.match(style, /tr[^{]*\{[^}]*break-inside:\s*avoid/);
    assert.match(style, /\.qe-figure img[^{]*\{[^}]*max-width:\s*100%/);
  });

  it("prints the caption text and hides the editing controls", () => {
    assert.match(images, /<figcaption/);
    assert.match(images, /qe-no-print flex flex-wrap/);
  });

  it("section 6.6 shows the imported table above the live NCR table, plus the notes box", () => {
    const section = report.slice(report.indexOf('<Section number="6.6"'), report.indexOf('<Section number="6.7"'));
    assert.ok(section.indexOf("<NcrReportTable") >= 0 && section.indexOf("<NcrReportTable") < section.indexOf("ncr.data?.rows.map"));
    assert.match(section, /NCRs \/ CARs \/ PIRs \/ RPNs notes/);
  });
});
