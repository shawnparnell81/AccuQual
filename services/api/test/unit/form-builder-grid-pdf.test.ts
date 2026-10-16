import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { pdfVisibleText } from "../../src/modules/forms/controlledPdf.js";
import { cellColors, parseBorder, renderGridPdf } from "../../src/modules/form-builder/gridPdf.js";

const cell = (extra: Record<string, unknown> = {}) => ({ value: "", locked: false, rowSpan: 1, colSpan: 1, style: {}, ...extra });
const B = "1px solid #111111";
const box = { borderTop: B, borderRight: "2px dashed #0A3C7B", borderBottom: "3px double #111111", borderLeft: B };

function grid(widths: number[], rows: unknown[][], heights?: number[]) {
  return { kind: "grid", sheets: [{ name: "Readings", colWidths: widths, rowHeights: heights ?? rows.map(() => 24), cells: rows }] };
}

const base = { title: "Spring rate inspection", formNumber: "FRM-QA-210", revision: "C", recordNumber: "SR-0042", printedBy: "Pat Editor", printedAt: "Oct 15, 2026, 9:10 PM" };

describe("grid PDF", () => {
  it("shows typed answers, recalculated formulas, the stamp, the form number and REV", async () => {
    const structure = grid([110, 110, 110, 220], [
      [cell({ value: "Length", locked: true, type: "label", style: { bold: true, background: "#0A3C7B" } }), cell({ value: "Width", locked: true }), cell({ value: "Area", locked: true }), cell({ value: "Signature", locked: true })],
      [cell({ type: "number", style: box }), cell({ type: "number" }), cell({ formula: "A2*B2", locked: true, decimals: 1 }), cell({ type: "signature", locked: true, style: { wrap: true } })],
      [cell({ formula: 'IF(C2>10,"Pass","Fail")', locked: true, conditional: true, colSpan: 2 }), null, cell({ folderPath: true, locked: true }), cell({ value: "3φ 480V ✓", locked: true })],
    ]);
    const { bytes, layout } = await renderGridPdf({
      ...base,
      structure,
      answers: { "0!A2": "2.5", "0!B2": "6", "0!C2": "999", "0!D2": { stamped: true, text: "Pat Editor — Oct 15, 2026, 9:00 PM ET. I certify that this record is accurate." } },
      folderPath: "Quality Records / Inspections",
    });
    const text = (await pdfVisibleText(bytes)).replace(/\s+/g, " ");
    expect(text).toContain("Spring rate inspection");
    expect(text).toContain("Doc ID: FRM-QA-210");
    expect(text).toContain("Rev: C");
    expect(text).toContain("Record No. SR-0042");
    expect(text).toContain("15.0");
    expect(text).not.toContain("999");
    expect(text).toContain("Pass");
    expect(text).toContain("Pat Editor");
    expect(text).toContain("Quality Records / Inspections");
    expect(text).toContain("Page 1 of 1");
    expect(text).toContain("3? 480V ?");
    expect(layout).toMatchObject({ pages: 1, landscape: false, scale: 1 });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toBe("FRM-QA-210 Spring rate inspection SR-0042");
  });

  it("turns landscape for a wide grid and scales a grid wider than landscape to fit", async () => {
    const wide = await renderGridPdf({ ...base, structure: grid(Array(8).fill(110), [Array.from({ length: 8 }, () => cell())]), answers: {} });
    expect(wide.layout.landscape).toBe(true);
    expect(wide.layout.scale).toBe(1);
    const page = (await PDFDocument.load(wide.bytes)).getPage(0);
    expect(page.getWidth()).toBe(792);
    const wider = await renderGridPdf({ ...base, structure: grid(Array(20).fill(110), [Array.from({ length: 20 }, () => cell())]), answers: {} });
    expect(wider.layout.scale).toBeCloseTo(720 / (20 * 110 * 0.75), 5);
  });

  it("shows a date cell as MM/DD/YYYY, like the date box on screen", async () => {
    const { bytes } = await renderGridPdf({ ...base, structure: grid([120, 120], [[cell({ type: "date" }), cell({ type: "date" })]]), answers: { "0!A1": "2026-10-15", "0!B1": "next week" } });
    const text = await pdfVisibleText(bytes);
    expect(text).toContain("10/15/2026");
    expect(text).toContain("next week");
  });

  it("grows a row to show long text instead of cutting it off", async () => {
    const long = "This note is much longer than the cell is wide, so it wraps onto several lines in the PDF just as on screen.";
    const { bytes } = await renderGridPdf({ ...base, structure: grid([90, 90], [[cell({ type: "text" }), cell()]]), answers: { "0!A1": long } });
    const text = (await pdfVisibleText(bytes)).replace(/\s+/g, " ");
    expect(text).toContain("wraps onto several lines in the PDF just as on screen.");
  });

  it("breaks long grids into pages without splitting a merged block", async () => {
    const rows = Array.from({ length: 120 }, (_, row) => [cell({ value: `Row ${row + 1}`, locked: true }), cell()]);
    rows[28]![0] = cell({ value: "Merged block", locked: true, rowSpan: 4 });
    for (let r = 29; r < 32; r += 1) rows[r]![0] = null;
    const { bytes, layout } = await renderGridPdf({ ...base, structure: grid([200, 200], rows), answers: {} });
    expect(layout.pages).toBeGreaterThan(2);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(layout.pages);
    const text = await pdfVisibleText(bytes);
    expect(text).toContain(`Page ${layout.pages} of ${layout.pages}`);
    expect(text).toContain("Row 120");
  });

  it("paints Pass and Fail with the same colors as the screen and reads every border", () => {
    // The same ink the screen picks (inkOnFill): near-black on the Pass green and the Fail red.
    expect(cellColors(cell({ formula: "x" }) as never, "Pass")).toEqual({ background: "#4EA72E", color: "#111111" });
    expect(cellColors(cell({ conditional: true }) as never, "failed")).toEqual({ background: "#FF0000", color: "#111111" });
    expect(cellColors(cell({ formula: "x", style: { color: "#FFFFFF" } }) as never, "Fail")).toEqual({ background: "#FF0000", color: "#FFFFFF" });
    expect(cellColors(cell({ style: { background: "#0A3C7B" } }) as never, "x")).toEqual({ background: "#0A3C7B", color: "#FFFFFF" });
    expect(cellColors(cell({ style: { background: "#FFF2CC" } }) as never, "x")).toEqual({ background: "#FFF2CC", color: "#111111" });
    expect(parseBorder("2px dashed #0A3C7B")).toMatchObject({ width: 2, line: "dashed" });
    expect(parseBorder("3px double #111111")).toMatchObject({ width: 3, line: "double" });
    expect(parseBorder("1px dotted currentColor")).toMatchObject({ width: 1, line: "dotted" });
    expect(parseBorder("bogus")).toBeNull();
  });

  it("prints each sheet starting on its own page with its name", async () => {
    const structure = { kind: "grid", sheets: [grid([100], [[cell({ value: "one", locked: true })]]).sheets[0], { ...grid([100], [[cell({ value: "two", locked: true })]]).sheets[0], name: "Second" }] };
    const { bytes, layout } = await renderGridPdf({ ...base, structure, answers: {} });
    expect(layout.pages).toBe(2);
    const text = await pdfVisibleText(bytes);
    expect(text).toContain("Second");
  });
});
