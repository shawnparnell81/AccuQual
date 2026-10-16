/**
 * PDF of a filled grid copy, drawn from the copy's own layout so it matches the screen: column widths and row
 * heights, merged cells, every border side with its line and color, fills, fonts, alignment and wrapping, the
 * Pass and Fail colors, signature stamps, the form number and the REV the copy was opened at.
 *
 * Sizes on screen are CSS pixels; a PDF point is 0.75 px. A grid wider than the page is scaled down to fit, never
 * cropped. Rows are kept whole, and a block of merged rows is never split across pages. The A/B/C and 1/2/3
 * headers are design aids and are not printed.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { cellAddress } from "./formulaEngine.js";
import { recomputeGridAnswers } from "./gridFill.js";

const PX = 0.75;
const MARGIN = 36;
const HEADER = 54;
const FOOTER = 34;
const PORTRAIT: [number, number] = [612, 792];
const LANDSCAPE: [number, number] = [792, 612];
/** The screen's default cell text is 12px. */
const DEFAULT_PT = 9;
const PAD_X = 4 * PX;
const PAD_Y = 2 * PX;
const GRIDLINE = rgb(0.85, 0.87, 0.9);
const INK = rgb(0.067, 0.067, 0.067);
const PASS = { background: "#4EA72E", color: "#FFFFFF" };
const FAIL = { background: "#FF0000", color: "#FFFFFF" };

interface Style {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontFamily?: string;
  fontSizePt?: number;
  color?: string;
  background?: string;
  align?: string;
  valign?: string;
  wrap?: boolean;
  borderTop?: string;
  borderRight?: string;
  borderBottom?: string;
  borderLeft?: string;
}

interface Cell {
  value?: string;
  formula?: string;
  locked?: boolean;
  rowSpan?: number;
  colSpan?: number;
  type?: string;
  conditional?: boolean;
  folderPath?: boolean;
  style?: Style;
}

interface Sheet {
  name?: string;
  colWidths: number[];
  rowHeights: number[];
  cells: Array<Array<Cell | null>>;
}

export interface GridPdfInput {
  title: string;
  formNumber: string | null;
  revision: string;
  recordNumber: string | null;
  structure: unknown;
  answers: Record<string, unknown>;
  folderPath?: string | null;
  printedBy: string;
  printedAt: string;
  companyName?: string | null;
}

type Fonts = Record<"sans" | "sansBold" | "sansItalic" | "sansBoldItalic" | "serif" | "serifBold" | "serifItalic" | "serifBoldItalic" | "mono" | "monoBold" | "monoItalic" | "monoBoldItalic", PDFFont>;

function hex(color: string | undefined): RGB | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec((color ?? "").trim());
  if (!match) return null;
  const n = Number.parseInt(match[1]!, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function luminance(color: string): number {
  const n = Number.parseInt(color.replace("#", ""), 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** Same rule as the screen: white or near-black, whichever reads better on the fill. */
function inkOn(background: string): string {
  const lum = luminance(background);
  const dark = luminance("#111111");
  return (1.05) / (lum + 0.05) >= (Math.max(lum, dark) + 0.05) / (Math.min(lum, dark) + 0.05) ? "#FFFFFF" : "#111111";
}

/** The same colors the screen paints: Passed green, Failed red, otherwise the cell's own fill and ink. */
export function cellColors(cell: Cell, text: string): { background?: string; color?: string } {
  if (cell.conditional || cell.formula) {
    const label = text.trim().toLowerCase();
    const fill = label === "pass" || label === "passed" ? PASS : label === "fail" || label === "failed" ? FAIL : null;
    if (fill) return { background: fill.background, color: cell.style?.color || inkOn(fill.background) };
  }
  const background = cell.style?.background;
  if (cell.style?.color) return { background, color: cell.style.color };
  if (background && /^#[0-9a-fA-F]{6}$/.test(background)) return { background, color: inkOn(background) };
  return {};
}

function fontFor(fonts: Fonts, style: Style | undefined, italic = false): PDFFont {
  const family = (style?.fontFamily ?? "").toLowerCase();
  const base = /times|serif|georgia|garamond|cambria/.test(family) && !/sans/.test(family) ? "serif" : /courier|mono|consolas/.test(family) ? "mono" : "sans";
  const bold = Boolean(style?.bold);
  const slant = Boolean(style?.italic) || italic;
  const key = `${base}${bold && slant ? "BoldItalic" : bold ? "Bold" : slant ? "Italic" : ""}` as keyof Fonts;
  return fonts[key];
}

/** Characters the standard PDF fonts cannot draw are replaced, so one symbol never stops the export. */
function printable(font: PDFFont, text: string): string {
  const supported = new Set(font.getCharacterSet());
  let out = "";
  for (const ch of text.replace(/\t/g, " ")) {
    if (ch === "\n" || supported.has(ch.codePointAt(0)!)) out += ch;
    else if (ch === "\u2009" || ch === "\u00a0") out += " ";
    else out += "?";
  }
  return out;
}

function wrapLines(font: PDFFont, size: number, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/(\s+)/);
    let line = "";
    for (const word of words) {
      const next = line + word;
      if (font.widthOfTextAtSize(next.trimEnd(), size) <= width || line === "") {
        if (font.widthOfTextAtSize(next.trimEnd(), size) > width && line === "") {
          // A single word wider than the cell is broken by characters.
          let piece = "";
          for (const ch of word) {
            if (font.widthOfTextAtSize(piece + ch, size) > width && piece) {
              lines.push(piece);
              piece = ch;
            } else piece += ch;
          }
          line = piece;
        } else line = next;
      } else {
        lines.push(line.trimEnd());
        line = word.trimStart();
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function fitOneLine(font: PDFFont, size: number, text: string, width: number): string {
  const flat = text.replace(/\s*\n\s*/g, " ");
  if (font.widthOfTextAtSize(flat, size) <= width) return flat;
  let cut = flat;
  while (cut.length > 0 && font.widthOfTextAtSize(cut, size) > width) cut = cut.slice(0, -1);
  return cut;
}

interface Border {
  width: number;
  line: string;
  color: RGB;
}

export function parseBorder(value: string | undefined): Border | null {
  const match = /^([1-3])px (solid|dashed|double|dotted) (#[0-9a-fA-F]{6}|currentColor)$/.exec((value ?? "").trim());
  if (!match) return null;
  return { width: Number(match[1]), line: match[2]!, color: match[3] === "currentColor" ? INK : hex(match[3])! };
}

function drawEdge(page: PDFPage, border: Border, scale: number, start: { x: number; y: number }, end: { x: number; y: number }) {
  const thickness = Math.max(0.4, border.width * PX * scale);
  if (border.line === "double") {
    const gap = thickness / 3;
    const vertical = start.x === end.x;
    for (const offset of [-gap, gap]) {
      page.drawLine({
        start: vertical ? { x: start.x + offset, y: start.y } : { x: start.x, y: start.y + offset },
        end: vertical ? { x: end.x + offset, y: end.y } : { x: end.x, y: end.y + offset },
        thickness: Math.max(0.3, thickness / 3),
        color: border.color,
      });
    }
    return;
  }
  page.drawLine({
    start,
    end,
    thickness,
    color: border.color,
    dashArray: border.line === "dashed" ? [3 * scale + 1, 2 * scale + 1] : border.line === "dotted" ? [thickness, thickness * 1.5] : undefined,
  });
}

/** What a cell shows on the copy: the typed answer, the calculated result, the stamp, the folder path or its label. */
function shownText(cell: Cell, key: string, answers: Record<string, unknown>, folderPath: string | null | undefined): string {
  if (cell.folderPath) return folderPath ?? "";
  const answer = answers[key];
  if (cell.type === "signature") {
    if (answer && typeof answer === "object" && (answer as { stamped?: boolean }).stamped) return String((answer as { text?: unknown }).text ?? "");
    return "";
  }
  if (cell.formula) return typeof answer === "string" ? answer : "";
  const value = !cell.locked && typeof answer === "string" ? answer : (cell.value ?? "");
  // A date cell reads as it does in the date box on screen (MM/DD/YYYY). Anything else typed there is kept as typed.
  const date = cell.type === "date" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim()) : null;
  return date ? `${date[2]}/${date[3]}/${date[1]}` : value;
}

function sheetsOf(structure: unknown): Sheet[] {
  if (!structure || typeof structure !== "object") return [];
  const record = structure as { kind?: unknown; sheets?: unknown };
  if (record.kind !== "grid" || !Array.isArray(record.sheets)) return [];
  return record.sheets as Sheet[];
}

/** Rows that must stay on one page together because a merge spans them. */
function rowBlocks(sheet: Sheet): Array<[number, number]> {
  const rows = sheet.cells.length;
  const reach = Array.from({ length: rows }, (_, row) => row);
  sheet.cells.forEach((line, row) => {
    line.forEach((cell) => {
      if (cell && (cell.rowSpan ?? 1) > 1) reach[row] = Math.max(reach[row]!, Math.min(rows - 1, row + (cell.rowSpan ?? 1) - 1));
    });
  });
  const blocks: Array<[number, number]> = [];
  let start = 0;
  let end = 0;
  for (let row = 0; row < rows; row += 1) {
    end = Math.max(end, reach[row]!);
    if (row === end) {
      blocks.push([start, end]);
      start = row + 1;
      end = row + 1;
    }
  }
  return blocks;
}

async function loadFonts(doc: PDFDocument): Promise<Fonts> {
  const [sans, sansBold, sansItalic, sansBoldItalic, serif, serifBold, serifItalic, serifBoldItalic, mono, monoBold, monoItalic, monoBoldItalic] = await Promise.all(
    [
      StandardFonts.Helvetica,
      StandardFonts.HelveticaBold,
      StandardFonts.HelveticaOblique,
      StandardFonts.HelveticaBoldOblique,
      StandardFonts.TimesRoman,
      StandardFonts.TimesRomanBold,
      StandardFonts.TimesRomanItalic,
      StandardFonts.TimesRomanBoldItalic,
      StandardFonts.Courier,
      StandardFonts.CourierBold,
      StandardFonts.CourierOblique,
      StandardFonts.CourierBoldOblique,
    ].map((name) => doc.embedFont(name)),
  );
  return { sans: sans!, sansBold: sansBold!, sansItalic: sansItalic!, sansBoldItalic: sansBoldItalic!, serif: serif!, serifBold: serifBold!, serifItalic: serifItalic!, serifBoldItalic: serifBoldItalic!, mono: mono!, monoBold: monoBold!, monoItalic: monoItalic!, monoBoldItalic: monoBoldItalic! };
}

export interface GridPdfLayout {
  pages: number;
  landscape: boolean;
  scale: number;
}

export async function renderGridPdf(input: GridPdfInput): Promise<{ bytes: Uint8Array; layout: GridPdfLayout }> {
  const doc = await PDFDocument.create();
  const fonts = await loadFonts(doc);
  const sheets = sheetsOf(input.structure);
  // Formula cells are worked out again here, so the PDF never shows a stale result.
  const answers = recomputeGridAnswers(input.structure, input.answers) ?? input.answers;
  const widest = Math.max(1, ...sheets.map((sheet) => sheet.colWidths.reduce((sum, width) => sum + width, 0) * PX));
  const landscape = widest > PORTRAIT[0] - MARGIN * 2;
  const [pageWidth, pageHeight] = landscape ? LANDSCAPE : PORTRAIT;
  const usableWidth = pageWidth - MARGIN * 2;
  const scale = Math.min(1, usableWidth / widest);
  const docId = input.formNumber?.trim() || "";
  const pages: PDFPage[] = [];

  function newPage(sheetName: string | null): { page: PDFPage; y: number } {
    const page = doc.addPage([pageWidth, pageHeight]);
    pages.push(page);
    const top = pageHeight - MARGIN;
    const titleFont = fonts.sansBold;
    const title = printable(titleFont, input.title);
    page.drawText(fitOneLine(titleFont, 13, title, usableWidth - 170), { x: MARGIN, y: top - 13, size: 13, font: titleFont, color: rgb(0.04, 0.24, 0.48) });
    const right = [docId ? `Doc ID: ${docId}` : "", `Rev: ${input.revision}`].filter(Boolean);
    right.forEach((line, index) => {
      const text = printable(fonts.sans, line);
      const width = fonts.sans.widthOfTextAtSize(text, 9);
      page.drawText(text, { x: pageWidth - MARGIN - width, y: top - 10 - index * 11, size: 9, font: fonts.sans, color: INK });
    });
    const sub = [input.recordNumber ? `Record No. ${input.recordNumber}` : "", sheetName ?? ""].filter(Boolean).join("   ·   ");
    if (sub) page.drawText(printable(fonts.sans, sub), { x: MARGIN, y: top - 28, size: 9, font: fonts.sans, color: rgb(0.3, 0.3, 0.3) });
    page.drawLine({ start: { x: MARGIN, y: top - 36 }, end: { x: pageWidth - MARGIN, y: top - 36 }, thickness: 0.6, color: rgb(0.04, 0.24, 0.48) });
    return { page, y: pageHeight - MARGIN - HEADER };
  }

  for (const sheet of sheets.length ? sheets : [{ name: "", colWidths: [], rowHeights: [], cells: [] }]) {
    const sheetIndex = sheets.indexOf(sheet as Sheet);
    const label = sheets.length > 1 ? (sheet.name ?? "") : null;
    let { page, y } = newPage(label);
    const xs: number[] = [MARGIN];
    sheet.colWidths.forEach((width) => xs.push(xs[xs.length - 1]! + width * PX * scale));
    const heights = sheet.rowHeights.map((height) => height * PX * scale);

    // Text is laid out first. As on screen, a row grows to show all of its text; nothing is cut off.
    type Placed = { row: number; col: number; rowSpan: number; cell: Cell; x: number; w: number; text: string; colors: { background?: string; color?: string }; font: PDFFont; size: number; lines: string[] };
    const placed: Placed[] = [];
    sheet.cells.forEach((line, row) => {
      line.forEach((cell, col) => {
        if (!cell) return;
        const rowSpan = Math.max(1, Math.min(cell.rowSpan ?? 1, sheet.cells.length - row));
        const colSpan = Math.max(1, Math.min(cell.colSpan ?? 1, sheet.colWidths.length - col));
        const x = xs[col]!;
        const w = xs[col + colSpan]! - x;
        const key = `${sheetIndex}!${cellAddress(col + 1, row + 1)}`;
        const text = shownText(cell, key, answers, input.folderPath);
        const style = cell.style ?? {};
        const signature = cell.type === "signature";
        const font = fontFor(fonts, style, signature);
        const size = (style.fontSizePt ? style.fontSizePt : signature ? 8 : DEFAULT_PT) * scale;
        const clean = text ? printable(font, text) : "";
        const lines = clean ? wrapLines(font, size, clean, Math.max(1, w - PAD_X * 2 * scale)) : [];
        placed.push({ row, col, rowSpan, cell, x, w, text, colors: cellColors(cell, text), font, size, lines });
        const needed = lines.length * size * 1.2 + PAD_Y * 2 * scale + 1;
        const have = heights.slice(row, row + rowSpan).reduce((sum, value) => sum + value, 0);
        if (needed > have) heights[row + rowSpan - 1] = heights[row + rowSpan - 1]! + (needed - have);
      });
    });

    const bottom = MARGIN + FOOTER;
    const rowTop: number[] = [];
    const rowPage: PDFPage[] = [];
    for (const [first, last] of rowBlocks(sheet)) {
      const blockHeight = heights.slice(first, last + 1).reduce((sum, h) => sum + h, 0);
      if (y - blockHeight < bottom && y < pageHeight - MARGIN - HEADER) ({ page, y } = newPage(label));
      for (let row = first; row <= last; row += 1) {
        rowTop[row] = y;
        rowPage[row] = page;
        y -= heights[row]!;
      }
    }

    // Light cell lines first, as on screen, then fills, then text, then the cell's own borders on top.
    const anchors = placed.map((item) => ({ ...item, top: rowTop[item.row]!, h: heights.slice(item.row, item.row + item.rowSpan).reduce((sum, value) => sum + value, 0), page: rowPage[item.row]! }));
    for (const a of anchors) {
      const fill = hex(a.colors.background);
      a.page.drawRectangle({ x: a.x, y: a.top - a.h, width: a.w, height: a.h, color: fill ?? undefined, borderColor: GRIDLINE, borderWidth: 0.5 });
      if (a.lines.length === 0) continue;
      const style = a.cell.style ?? {};
      const size = a.size;
      const lineHeight = size * 1.2;
      const blockHeight = a.lines.length * lineHeight;
      const valign = style.valign ?? (a.cell.type === "signature" ? "middle" : "top");
      let baseline = valign === "middle" ? a.top - (a.h - blockHeight) / 2 - size : valign === "bottom" ? a.top - a.h + blockHeight - size + PAD_Y * scale : a.top - PAD_Y * scale - size;
      const ink = hex(a.colors.color) ?? INK;
      for (const lineText of a.lines) {
        const width = a.font.widthOfTextAtSize(lineText, size);
        const x = style.align === "center" ? a.x + (a.w - width) / 2 : style.align === "right" ? a.x + a.w - PAD_X * scale - width : a.x + PAD_X * scale;
        a.page.drawText(lineText, { x, y: baseline, size, font: a.font, color: ink });
        if (style.underline) a.page.drawLine({ start: { x, y: baseline - 1 }, end: { x: x + width, y: baseline - 1 }, thickness: 0.5 * scale, color: ink });
        baseline -= lineHeight;
      }
    }
    for (const a of anchors) {
      const style = a.cell.style ?? {};
      const left = a.x;
      const right = a.x + a.w;
      const top = a.top;
      const low = a.top - a.h;
      const sides: Array<[string | undefined, { x: number; y: number }, { x: number; y: number }]> = [
        [style.borderTop, { x: left, y: top }, { x: right, y: top }],
        [style.borderRight, { x: right, y: top }, { x: right, y: low }],
        [style.borderBottom, { x: left, y: low }, { x: right, y: low }],
        [style.borderLeft, { x: left, y: top }, { x: left, y: low }],
      ];
      for (const [value, start, end] of sides) {
        const border = parseBorder(value);
        if (border) drawEdge(a.page, border, scale, start, end);
      }
    }
  }

  const total = pages.length;
  pages.forEach((page, index) => {
    const y = MARGIN - 4;
    page.drawLine({ start: { x: MARGIN, y: y + 12 }, end: { x: pageWidth - MARGIN, y: y + 12 }, thickness: 0.4, color: rgb(0.7, 0.75, 0.8) });
    const left = printable(fonts.sans, [docId, `Rev ${input.revision}`, input.recordNumber ?? ""].filter(Boolean).join("   "));
    page.drawText(left, { x: MARGIN, y, size: 8, font: fonts.sans, color: rgb(0.25, 0.25, 0.25) });
    const right = printable(fonts.sans, `Printed ${input.printedAt} by ${input.printedBy}   Page ${index + 1} of ${total}`);
    const width = fonts.sans.widthOfTextAtSize(right, 8);
    page.drawText(right, { x: pageWidth - MARGIN - width, y, size: 8, font: fonts.sans, color: rgb(0.25, 0.25, 0.25) });
  });

  doc.setTitle([docId, input.title, input.recordNumber].filter(Boolean).join(" "));
  doc.setAuthor(input.printedBy);
  doc.setSubject(`${input.title} Rev ${input.revision}`);
  doc.setCreator(input.companyName || "AccuQual");
  doc.setProducer("AccuQual");
  const bytes = await doc.save();
  return { bytes, layout: { pages: total, landscape, scale } };
}
