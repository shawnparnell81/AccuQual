import { describe, expect, it } from "vitest";
import { emptyFrame } from "../../src/modules/forms/controlledPdf.js";
import { parseSheetLayout, renderLayoutPdf, sliceSheet, unsavedValues } from "../../src/modules/records/layoutPdf.js";

const black = "rgb(0, 0, 0)";
function layout(height: number, values: string[] = []) {
  const rows = Math.floor(height / 40);
  return parseSheetLayout({
    version: 1, width: 800, height,
    boxes: Array.from({ length: rows }, (_, i) => ({ x: 0, y: i * 40, w: 800, h: 40, b: [{ w: 1, c: black, s: "solid" }, { w: 1, c: black, s: "solid" }, { w: 1, c: black, s: "solid" }, { w: 1, c: black, s: "solid" }] })),
    texts: values.map((t, i) => ({ x: 10, y: i * 40 + 10, w: 200, h: 16, t, size: 12, bold: false, italic: false, mono: false, serif: false, color: black, underline: false })),
    images: [], ticks: [{ x: 700, y: 10, w: 12, h: 12, on: true, round: false }],
    values,
    breaks: Array.from({ length: rows }, (_, i) => (i + 1) * 40),
  });
}

describe("exact-layout PDF", () => {
  it("cuts pages at row bottoms", () => {
    const slices = sliceSheet(1000, 300, [40, 80, 120, 160, 200, 240, 280, 320, 360, 1000]);
    expect(slices[0]).toEqual({ top: 0, bottom: 280 });
    expect(slices.at(-1)!.bottom).toBe(1000);
  });

  it("flags values that are not in the saved record", () => {
    expect(unsavedValues(layout(80, ["Lot 7", "12.5"]), ["Lot 7", 12.5])).toEqual([]);
    expect(unsavedValues(layout(80, ["Lot 8"]), ["Lot 7"])).toEqual(["Lot 8"]);
  });

  it("rejects a malformed layout", () => {
    expect(() => parseSheetLayout({ version: 2 })).toThrow(/layout/);
  });

  it("draws a long sheet over several pages", async () => {
    const frame = emptyFrame({ sourceModule: "Test", recordNumber: "R-1", revision: "B", generatedBy: "Tester", formNumber: "F-1" });
    const { bytes, pages } = await renderLayoutPdf({ layout: layout(4000, ["Lot 7"]), frame, title: "Test" });
    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF");
    expect(pages).toBeGreaterThan(3);
  });
});

describe("page header", () => {
  it("cuts a long header to fit", async () => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const { fitText } = await import("../../src/modules/records/layoutPdf.js");
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    const cut = fitText("FRM-VAL-004 ELECTRIC LIFT SUPPORT VALIDATION DOCUMENT", font, 9, 100);
    expect(cut.endsWith("...")).toBe(true);
    expect(font.widthOfTextAtSize(cut, 9)).toBeLessThanOrEqual(100);
    expect(fitText("Rev C", font, 9, 100)).toBe("Rev C");
  });
});
