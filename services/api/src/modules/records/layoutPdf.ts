/**
 * PDF of a sheet-style record (ISO forms, QMS forms, validation reports) drawn from the layout the screen shows:
 * the same boxes, column widths, merged cells, each border side, fills, text placed where it sits, typed values,
 * ticks, logos, signatures and charts. The browser sends the layout (see apps/web/src/lib/sheetLayout.ts); the
 * header, footer, record number, REV and export id come from the saved record here, never from the browser.
 *
 * Screen sizes are CSS pixels; a PDF point is 0.75 px. A sheet wider than the page is scaled down to fit, never
 * cropped, and a wide sheet prints landscape. Pages end at the bottom of a table row or block where one fits.
 */
import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { z } from "zod";
import { AppError } from "../../utils/appError.js";
import { watermarkForStatus, type ControlledPdfFrame } from "../forms/controlledPdf.js";

const PX = 0.75;
const MARGIN = 28;
const HEADER = 40;
const FOOTER = 30;
const PORTRAIT: [number, number] = [612, 792];
const LANDSCAPE: [number, number] = [792, 612];
const INK = rgb(0.067, 0.067, 0.067);
const MUTED = rgb(0.35, 0.38, 0.42);

const side = z.object({ w: z.number().min(0).max(40), c: z.string().max(80), s: z.string().max(20) }).nullable();
const num = z.number().finite();
export const sheetLayoutSchema = z.object({
  version: z.literal(1),
  width: num.positive().max(20_000),
  height: num.positive().max(400_000),
  boxes: z.array(z.object({ x: num, y: num, w: num, h: num, bg: z.string().max(80).optional(), b: z.tuple([side, side, side, side]).optional() })).max(80_000),
  texts: z
    .array(
      z.object({
        x: num, y: num, w: num, h: num,
        t: z.string().max(20_000),
        size: num.positive().max(200),
        bold: z.boolean(), italic: z.boolean(), mono: z.boolean(), serif: z.boolean(),
        color: z.string().max(80), underline: z.boolean(),
        wrap: z.boolean().optional(),
        align: z.enum(["left", "center", "right"]).optional(),
      }),
    )
    .max(80_000),
  images: z.array(z.object({ x: num, y: num, w: num, h: num, src: z.string().max(4_000_000) })).max(200),
  ticks: z.array(z.object({ x: num, y: num, w: num, h: num, on: z.boolean(), round: z.boolean() })).max(20_000),
  values: z.array(z.string().max(20_000)).max(40_000),
  breaks: z.array(num).max(100_000),
});
export type SheetLayout = z.infer<typeof sheetLayoutSchema>;

export function parseSheetLayout(body: unknown): SheetLayout {
  const parsed = sheetLayoutSchema.safeParse((body as { layout?: unknown } | null)?.layout ?? body);
  if (!parsed.success) throw AppError.badRequest("Couldn't read this form's layout. Refresh the page and try again.");
  return parsed.data;
}

// ---- Integrity: the PDF prints the saved copy --------------------------------------------------------------

function normal(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function collect(value: unknown, into: Set<string>, numbers: Set<number>, depth = 0) {
  if (depth > 12 || value == null) return;
  if (typeof value === "string") {
    const n = normal(value);
    if (!n) return;
    into.add(n);
    if (/^\d{4}-\d{2}-\d{2}/.test(n)) into.add(n.slice(0, 10));
    const asNumber = Number(n.replace(/,/g, ""));
    if (n !== "" && Number.isFinite(asNumber)) numbers.add(asNumber);
    return;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      numbers.add(value);
      into.add(String(value));
    }
    return;
  }
  if (typeof value === "boolean") {
    into.add(String(value));
    return;
  }
  if (value instanceof Date) {
    into.add(value.toISOString().slice(0, 10));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collect(item, into, numbers, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      // A tick group stores {"Major": true}; the field's value is its name.
      if (item === true) into.add(normal(key));
      collect(item, into, numbers, depth + 1);
    }
  }
}

/** Field values on screen that the saved record does not hold. Empty means the screen shows the saved copy. */
export function unsavedValues(layout: SheetLayout, saved: unknown[]): string[] {
  const strings = new Set<string>(["true", "on"]);
  const numbers = new Set<number>();
  for (const item of saved) collect(item, strings, numbers);
  const missing: string[] = [];
  for (const raw of layout.values) {
    const n = normal(raw);
    if (!n || strings.has(n)) continue;
    const asNumber = Number(n.replace(/,/g, ""));
    if (Number.isFinite(asNumber) && [...numbers].some((value) => Math.abs(value - asNumber) < 1e-9)) continue;
    missing.push(raw);
  }
  return missing;
}

export function assertSavedCopy(layout: SheetLayout, saved: unknown[]) {
  const missing = unsavedValues(layout, saved);
  if (missing.length > 0) throw new AppError("Save your changes first; the PDF shows the saved copy.", 409);
}

// ---- Drawing ---------------------------------------------------------------------------------------------

function color(css: string | undefined): RGB | null {
  if (!css) return null;
  const m = /rgba?\(([^)]+)\)/.exec(css);
  if (m) {
    const [r, g, b, a] = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
    if (a !== undefined && a <= 0.02) return null;
    const alpha = a === undefined || Number.isNaN(a) ? 1 : a;
    // Blend a see-through color onto white, which is what the screen shows on the sheet.
    const mix = (v: number) => Math.min(1, Math.max(0, ((v ?? 0) / 255) * alpha + (1 - alpha)));
    return rgb(mix(r!), mix(g!), mix(b!));
  }
  const h = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (h) {
    const v = parseInt(h[1]!, 16);
    return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
  }
  return null;
}

type FontSet = Record<string, PDFFont>;

async function loadFonts(pdf: PDFDocument): Promise<FontSet> {
  const pairs: [string, StandardFonts][] = [
    ["sans", StandardFonts.Helvetica], ["sans-b", StandardFonts.HelveticaBold], ["sans-i", StandardFonts.HelveticaOblique], ["sans-bi", StandardFonts.HelveticaBoldOblique],
    ["serif", StandardFonts.TimesRoman], ["serif-b", StandardFonts.TimesRomanBold], ["serif-i", StandardFonts.TimesRomanItalic], ["serif-bi", StandardFonts.TimesRomanBoldItalic],
    ["mono", StandardFonts.Courier], ["mono-b", StandardFonts.CourierBold], ["mono-i", StandardFonts.CourierOblique], ["mono-bi", StandardFonts.CourierBoldOblique],
  ];
  const fonts: FontSet = {};
  for (const [key, name] of pairs) fonts[key] = await pdf.embedFont(name);
  return fonts;
}

function fontFor(fonts: FontSet, t: { bold: boolean; italic: boolean; mono: boolean; serif: boolean }): PDFFont {
  const family = t.mono ? "mono" : t.serif ? "serif" : "sans";
  const style = t.bold && t.italic ? "-bi" : t.bold ? "-b" : t.italic ? "-i" : "";
  return fonts[family + style]!;
}

/** The standard PDF fonts cover Windows-1252. Other characters print as their closest plain form or "?". */
export function printable(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u2713\u2714]/g, "X")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[\r\t]/g, " ")
    .replace(/[^\n\x20-\x7e\u00a1-\u00ff€]/g, "?");
}

function wrapLines(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(next, size) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

export interface LayoutPdfInput {
  layout: SheetLayout;
  frame: ControlledPdfFrame;
  title: string;
}

interface Slice {
  top: number;
  bottom: number;
}

/** Page ends: the lowest row or block bottom that fits, else a straight cut. */
export function sliceSheet(height: number, pageHeightPx: number, breaks: number[]): Slice[] {
  const slices: Slice[] = [];
  const sorted = [...breaks].filter((b) => b > 0 && b < height).sort((a, b) => a - b);
  let top = 0;
  while (top < height - 0.5) {
    const limit = top + pageHeightPx;
    if (limit >= height) {
      slices.push({ top, bottom: height });
      break;
    }
    let cut = limit;
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      const b = sorted[i]!;
      if (b <= limit && b > top + pageHeightPx * 0.3) {
        cut = b;
        break;
      }
    }
    slices.push({ top, bottom: cut });
    top = cut;
  }
  return slices.length ? slices : [{ top: 0, bottom: height }];
}

export async function renderLayoutPdf(input: LayoutPdfInput): Promise<{ bytes: Uint8Array; pages: number }> {
  const { layout, frame } = input;
  const pdf = await PDFDocument.create();
  pdf.setTitle(input.title);
  pdf.setCreator("AccuQual");
  pdf.setProducer("AccuQual");
  const fonts = await loadFonts(pdf);
  const landscape = layout.width > 1000;
  const [pageW, pageH] = landscape ? LANDSCAPE : PORTRAIT;
  const contentW = pageW - MARGIN * 2;
  const contentH = pageH - MARGIN * 2 - HEADER - FOOTER;
  const scale = Math.min(PX, contentW / layout.width);
  const slices = sliceSheet(layout.height, contentH / scale, layout.breaks);

  const embedded = new Map<string, Awaited<ReturnType<PDFDocument["embedPng"]>>>();
  async function picture(src: string) {
    if (embedded.has(src)) return embedded.get(src)!;
    const m = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(src);
    if (!m) return null;
    const bytes = Buffer.from(m[2]!, "base64");
    const image = m[1] === "png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    embedded.set(src, image);
    return image;
  }

  const watermark = watermarkForStatus(frame.status);
  for (const [index, slice] of slices.entries()) {
    const page = pdf.addPage([pageW, pageH]);
    const originY = pageH - MARGIN - HEADER;
    const X = (x: number) => MARGIN + x * scale;
    const Y = (y: number) => originY - (y - slice.top) * scale;
    const within = (y: number, h: number) => y + h > slice.top + 0.5 && y < slice.bottom - 0.5;

    for (const box of layout.boxes) {
      if (!within(box.y, box.h)) continue;
      const top = Math.max(box.y, slice.top);
      const bottom = Math.min(box.y + box.h, slice.bottom);
      const fill = color(box.bg);
      if (fill) page.drawRectangle({ x: X(box.x), y: Y(bottom), width: box.w * scale, height: (bottom - top) * scale, color: fill });
      if (!box.b) continue;
      const [t, r, b, l] = box.b;
      const line = (s: NonNullable<typeof t>, x1: number, y1: number, x2: number, y2: number) => {
        const c = color(s.c);
        if (!c) return;
        page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: Math.max(0.25, s.w * scale), color: c, dashArray: s.s === "dashed" ? [3, 2] : s.s === "dotted" ? [1, 1.5] : undefined });
      };
      if (t && box.y >= slice.top - 0.5) line(t, X(box.x), Y(box.y + t.w / 2), X(box.x + box.w), Y(box.y + t.w / 2));
      if (b && box.y + box.h <= slice.bottom + 0.5) line(b, X(box.x), Y(box.y + box.h - b.w / 2), X(box.x + box.w), Y(box.y + box.h - b.w / 2));
      if (l) line(l, X(box.x + l.w / 2), Y(top), X(box.x + l.w / 2), Y(bottom));
      if (r) line(r, X(box.x + box.w - r.w / 2), Y(top), X(box.x + box.w - r.w / 2), Y(bottom));
    }

    for (const image of layout.images) {
      if (!within(image.y, image.h) || image.y < slice.top - 1) continue;
      const embeddedImage = await picture(image.src).catch(() => null);
      if (!embeddedImage) continue;
      page.drawImage(embeddedImage, { x: X(image.x), y: Y(image.y + image.h), width: image.w * scale, height: image.h * scale });
    }

    for (const tick of layout.ticks) {
      if (!within(tick.y, tick.h)) continue;
      const size = Math.min(tick.w, tick.h) * scale;
      const x = X(tick.x) + (tick.w * scale - size) / 2;
      const y = Y(tick.y + tick.h) + (tick.h * scale - size) / 2;
      if (tick.round) {
        page.drawEllipse({ x: x + size / 2, y: y + size / 2, xScale: size / 2, yScale: size / 2, borderColor: INK, borderWidth: 0.6 });
        if (tick.on) page.drawEllipse({ x: x + size / 2, y: y + size / 2, xScale: size / 4, yScale: size / 4, color: INK });
      } else {
        page.drawRectangle({ x, y, width: size, height: size, borderColor: INK, borderWidth: 0.6 });
        if (tick.on) {
          page.drawLine({ start: { x: x + size * 0.2, y: y + size * 0.5 }, end: { x: x + size * 0.42, y: y + size * 0.22 }, thickness: Math.max(0.8, size * 0.12), color: INK });
          page.drawLine({ start: { x: x + size * 0.42, y: y + size * 0.22 }, end: { x: x + size * 0.82, y: y + size * 0.8 }, thickness: Math.max(0.8, size * 0.12), color: INK });
        }
      }
    }

    for (const text of layout.texts) {
      if (text.y < slice.top - 0.5 || text.y >= slice.bottom - 0.5) continue;
      const font = fontFor(fonts, text);
      const size = text.size * scale;
      const ink = color(text.color) ?? INK;
      const lineHeight = size * 1.2;
      const lines = text.wrap ? wrapLines(printable(text.t), font, size, text.w * scale) : [printable(text.t).replace(/\n/g, " ")];
      // A single line sits centred in its box, the way the screen draws it.
      let baseline = text.wrap ? Y(text.y) - size : Y(text.y + text.h / 2) - size * 0.35;
      for (const content of lines) {
        if (text.wrap && baseline < Y(Math.min(text.y + text.h, slice.bottom)) - 1) break;
        let width = font.widthOfTextAtSize(content, size);
        let drawSize = size;
        // Kept on its line: a run a little wider than the screen's font is narrowed, not wrapped.
        if (!text.wrap && width > text.w * scale * 1.04 && text.w > 0) {
          drawSize = size * ((text.w * scale) / width);
          width = text.w * scale;
        }
        const x = text.align === "center" ? X(text.x) + (text.w * scale - width) / 2 : text.align === "right" ? X(text.x) + text.w * scale - width : X(text.x);
        page.drawText(content, { x, y: baseline, size: drawSize, font, color: ink });
        if (text.underline) page.drawLine({ start: { x, y: baseline - 1 }, end: { x: x + width, y: baseline - 1 }, thickness: 0.5, color: ink });
        baseline -= lineHeight;
      }
    }

    drawChrome(page, fonts, frame, input.title, index + 1, slices.length, pageW, pageH);
    if (watermark) {
      page.drawText(watermark, { x: pageW * 0.18, y: pageH * 0.3, size: 64, font: fonts["sans-b"]!, color: rgb(0.85, 0.2, 0.2), opacity: 0.12, rotate: degrees(35) });
    }
  }
  const bytes = await pdf.save();
  return { bytes, pages: slices.length };
}

function drawChrome(page: PDFPage, fonts: FontSet, frame: ControlledPdfFrame, title: string, pageNo: number, pages: number, pageW: number, pageH: number) {
  const bold = fonts["sans-b"]!;
  const regular = fonts.sans!;
  const top = pageH - MARGIN;
  const left = MARGIN;
  const right = pageW - MARGIN;
  page.drawText(printable(title).slice(0, 90), { x: left, y: top - 12, size: 10, font: bold, color: INK });
  const ids = [frame.formNumber ? `Doc ID ${frame.formNumber}` : "", frame.revision ? `Rev ${frame.revision}` : "", frame.recordNumber ? `Record ${frame.recordNumber}` : ""].filter(Boolean).join("   ");
  if (ids) {
    const text = printable(ids);
    page.drawText(text, { x: right - regular.widthOfTextAtSize(text, 9), y: top - 12, size: 9, font: regular, color: INK });
  }
  const notes = [frame.marking ? printable(frame.marking) : "", frame.legalHold ? "LEGAL HOLD" : ""].filter(Boolean).join("   ");
  if (notes) page.drawText(notes, { x: left, y: top - 26, size: 8, font: bold, color: rgb(0.7, 0.1, 0.1) });
  page.drawLine({ start: { x: left, y: top - HEADER + 8 }, end: { x: right, y: top - HEADER + 8 }, thickness: 0.5, color: MUTED });

  const bottom = MARGIN;
  page.drawLine({ start: { x: left, y: bottom + FOOTER - 8 }, end: { x: right, y: bottom + FOOTER - 8 }, thickness: 0.5, color: MUTED });
  const when = frame.generatedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const line1 = printable(`Export ${frame.exportId}${frame.verifyUrl ? `  Verify: ${frame.verifyUrl}` : ""}`);
  const line2 = printable(`Printed by ${frame.generatedBy} on ${when}`);
  page.drawText(line1.slice(0, 140), { x: left, y: bottom + 10, size: 7, font: regular, color: MUTED });
  page.drawText(line2.slice(0, 140), { x: left, y: bottom + 1, size: 7, font: regular, color: MUTED });
  const pageText = `Page ${pageNo} of ${pages}`;
  page.drawText(pageText, { x: right - regular.widthOfTextAtSize(pageText, 8), y: bottom + 5, size: 8, font: regular, color: MUTED });
}
