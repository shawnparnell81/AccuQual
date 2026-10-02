import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Block, FormLayout, TableColumn } from "./layouts/types.js";
import { hydrateDimensionalRow, measuredCellValue, passFailPdfPalette } from "../../utils/passFail.js";
import { FMEA_PDF_TONE, fmeaCellValue, fmeaComputedTone } from "./fmeaPriority.js";
import { pictureTextToPlain } from "../attachments/inlinePicture.js";
import { drawDmaLogo, embedDmaLogo } from "../branding/dmaLogo.js";

// Colors sampled from the reference templates (dark navy header bars, pale
// blue-gray field boxes, thin blue-gray borders) — kept as named constants so
// every form drawn through this renderer looks like the same document family.
const NAVY = rgb(0.114, 0.227, 0.361);
const LABEL_BG = rgb(0.933, 0.961, 0.984);
const BORDER = rgb(0.788, 0.847, 0.906);
const TEXT_DARK = rgb(0.13, 0.13, 0.15);
const TEXT_HINT = rgb(0.42, 0.45, 0.5);
const WHITE = rgb(1, 1, 1);

export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;
export const MARGIN = 40;
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

/** A table this wide does not fit a portrait letter page. NCR's widest table is 7 columns and CAPA's is 4, so both stay portrait. */
const WIDE_TABLE_COLUMNS = 8;

function contentWidth(ctx: RenderContext): number {
  return ctx.page.getWidth() - MARGIN * 2;
}

function pageSizeFor(layout: FormLayout): [number, number] {
  let widest = 0;
  for (const section of layout.sections) {
    for (const block of section.blocks) {
      if (block.type === "table") widest = Math.max(widest, block.columns.length);
    }
  }
  if (widest >= WIDE_TABLE_COLUMNS) return [PAGE_HEIGHT, PAGE_WIDTH];
  return [PAGE_WIDTH, PAGE_HEIGHT];
}

export interface RenderContext {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

/** Renders a FormLayout + its current data as a PDF matching the reference document's look. */
export async function renderFormLayoutAsPdf(layout: FormLayout, data: Record<string, unknown>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const [pageWidth, pageHeight] = pageSizeFor(layout);
  const ctx: RenderContext = { doc, page: doc.addPage([pageWidth, pageHeight]), y: pageHeight - MARGIN, font, bold, italic };

  await drawTitle(ctx, layout.title);

  for (const section of layout.sections) {
    ensureSpace(ctx, 26);
    drawSectionHeader(ctx, `${section.number}. ${section.title}`);
    for (const block of section.blocks) {
      drawBlock(ctx, block, data);
    }
    ctx.y -= 10; // gap between sections
  }

  return doc.save();
}

export function ensureSpace(ctx: RenderContext, needed: number) {
  if (ctx.y - needed < MARGIN) {
    const width = ctx.page.getWidth();
    const height = ctx.page.getHeight();
    ctx.page = ctx.doc.addPage([width, height]);
    ctx.y = height - MARGIN;
  }
}

export async function drawTitle(ctx: RenderContext, title: string) {
  const span = contentWidth(ctx);
  const logoH = 32;
  const logo = await embedDmaLogo(ctx.doc);
  const logoTop = ctx.y + 12;
  const logoW = drawDmaLogo(ctx.page, logo, MARGIN, logoTop, logoH);
  const textSpan = Math.max(80, span - logoW - 12);
  const lines = fitTextLines(title, ctx.bold, 16, textSpan);
  const textX = MARGIN + logoW + 8;
  let baseline = logoTop - Math.max(16, (logoH - lines.length * 20) / 2) - 2;
  for (const line of lines) {
    const width = ctx.bold.widthOfTextAtSize(line, 16);
    const x = textX + Math.max(0, (textSpan - width) / 2);
    ctx.page.drawText(line, { x, y: baseline, size: 16, font: ctx.bold, color: NAVY });
    baseline -= 20;
  }
  ctx.y = Math.min(logoTop - logoH, baseline + 12) - 8;
}

export function drawSectionHeader(ctx: RenderContext, text: string) {
  const height = 20;
  const span = contentWidth(ctx);
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - height, width: span, height, color: NAVY });
  ctx.page.drawText(text, { x: MARGIN + 8, y: ctx.y - height + 6, size: 10.5, font: ctx.bold, color: WHITE });
  ctx.y -= height;
}

export function drawBlock(ctx: RenderContext, block: Block, data: Record<string, unknown>) {
  switch (block.type) {
    case "row":
      return drawRow(ctx, block.fields, data);
    case "textarea":
      return drawTextarea(ctx, block.name, block.label, block.hint, data);
    case "yesno":
      return drawYesNo(ctx, block.name, block.label, data);
    case "table":
      return drawTable(ctx, block.name, block.columns, data, block.fixedRowLabels, block.labelColumnHeader, block.minRows, block.legend);
  }
}

function drawRow(ctx: RenderContext, fields: { name: string; label: string; hint?: string }[], data: Record<string, unknown>) {
  const height = fields.some((f) => f.hint) ? 34 : 26;
  ensureSpace(ctx, height);
  const span = contentWidth(ctx);
  const pairWidth = span / fields.length;
  const labelWidth = pairWidth * 0.42;
  const valueWidth = pairWidth * 0.58;

  fields.forEach((field, i) => {
    const x = MARGIN + i * pairWidth;
    ctx.page.drawRectangle({ x, y: ctx.y - height, width: labelWidth, height, color: LABEL_BG, borderColor: BORDER, borderWidth: 0.5 });
    ctx.page.drawRectangle({ x: x + labelWidth, y: ctx.y - height, width: valueWidth, height, color: WHITE, borderColor: BORDER, borderWidth: 0.5 });
    ctx.page.drawText(clipText(field.label, ctx.bold, 8, labelWidth - 8), { x: x + 4, y: ctx.y - 12, size: 8, font: ctx.bold, color: TEXT_DARK });
    if (field.hint) {
      ctx.page.drawText(truncate(field.hint, ctx.italic, 6.5, labelWidth - 8), { x: x + 4, y: ctx.y - height + 5, size: 6.5, font: ctx.italic, color: TEXT_HINT });
    }
    const value = data[field.name];
    if (value != null && value !== "") {
      ctx.page.drawText(truncate(String(value), ctx.font, 8.5, valueWidth - 8), { x: x + labelWidth + 4, y: ctx.y - 12, size: 8.5, font: ctx.font, color: TEXT_DARK });
    }
  });

  ctx.y -= height;
}

function drawTextarea(ctx: RenderContext, name: string, label: string, hint: string | undefined, data: Record<string, unknown>) {
  const headerHeight = hint ? 24 : 16;
  const bodyHeight = 70;
  ensureSpace(ctx, headerHeight + bodyHeight);

  const span = contentWidth(ctx);
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - headerHeight, width: span, height: headerHeight, color: LABEL_BG, borderColor: BORDER, borderWidth: 0.5 });
  ctx.page.drawText(label, { x: MARGIN + 4, y: ctx.y - 11, size: 8.5, font: ctx.bold, color: TEXT_DARK });
  if (hint) {
    ctx.page.drawText(hint, { x: MARGIN + 4, y: ctx.y - headerHeight + 6, size: 7, font: ctx.italic, color: TEXT_HINT });
  }
  ctx.y -= headerHeight;

  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - bodyHeight, width: span, height: bodyHeight, color: WHITE, borderColor: BORDER, borderWidth: 0.5 });
  const value = data[name];
  if (value != null && value !== "") {
    const lines = wrapText(pictureTextToPlain(String(value)), ctx.font, 9, span - 12).slice(0, Math.floor(bodyHeight / 12));
    lines.forEach((line, i) => {
      ctx.page.drawText(line, { x: MARGIN + 6, y: ctx.y - 12 - i * 12, size: 9, font: ctx.font, color: TEXT_DARK });
    });
  }
  ctx.y -= bodyHeight;
}

function drawYesNo(ctx: RenderContext, name: string, label: string, data: Record<string, unknown>) {
  const height = 22;
  ensureSpace(ctx, height);
  const span = contentWidth(ctx);
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - height, width: span, height, color: LABEL_BG, borderColor: BORDER, borderWidth: 0.5 });
  ctx.page.drawText(label, { x: MARGIN + 4, y: ctx.y - 14, size: 8.5, font: ctx.bold, color: TEXT_DARK });

  const value = String(data[name] ?? "").toLowerCase();
  const yesBoxX = MARGIN + span - 90;
  const noBoxX = MARGIN + span - 40;
  drawCheckbox(ctx, yesBoxX, ctx.y - 15, value === "yes");
  ctx.page.drawText("YES", { x: yesBoxX + 10, y: ctx.y - 14, size: 8, font: ctx.font, color: TEXT_DARK });
  drawCheckbox(ctx, noBoxX, ctx.y - 15, value === "no");
  ctx.page.drawText("NO", { x: noBoxX + 10, y: ctx.y - 14, size: 8, font: ctx.font, color: TEXT_DARK });

  ctx.y -= height;
}

function drawCheckbox(ctx: RenderContext, x: number, y: number, checked: boolean) {
  ctx.page.drawRectangle({ x, y, width: 8, height: 8, borderColor: TEXT_DARK, borderWidth: 0.75, color: checked ? TEXT_DARK : WHITE });
}

function drawTable(
  ctx: RenderContext,
  name: string,
  columns: TableColumn[],
  data: Record<string, unknown>,
  fixedRowLabels: string[] | undefined,
  labelColumnHeader: string | undefined,
  minRows: number | undefined,
  legend: string | undefined
) {
  const source = (data[name] as Record<string, unknown>[] | undefined) ?? [];
  const rows = columns.some((col) => col.formula === "dimensionalPassFail")
    ? source.map((row) => hydrateDimensionalRow(row && typeof row === "object" ? row : {}))
    : source;
  const rowCount = fixedRowLabels ? fixedRowLabels.length : Math.max(rows.length, minRows ?? 1);

  const span = contentWidth(ctx);
  const hasLabelColumn = Boolean(fixedRowLabels);
  const labelColWidth = hasLabelColumn ? span * 0.22 : 0;
  const remainingWidth = span - labelColWidth;
  const colWidth = remainingWidth / columns.length;

  // Every header stays inside its column. A label that fits stays one 18pt line.
  const headerLines = columns.map((col) => {
    const fitted = fitTextLines(pdfSafe(col.label), ctx.bold, 8, Math.max(8, colWidth - 8));
    return fitted.length > 0 ? fitted : [""];
  });
  const headerLabel = hasLabelColumn
    ? fitTextLines(pdfSafe(labelColumnHeader ?? "Role"), ctx.bold, 8, Math.max(8, labelColWidth - 8))
    : [];
  const headerLineCount = Math.max(1, headerLabel.length, ...headerLines.map((lines) => lines.length));
  const headerHeight = Math.max(18, headerLineCount * 10 + 6);
  ensureSpace(ctx, headerHeight);
  let x = MARGIN;
  if (hasLabelColumn) {
    ctx.page.drawRectangle({ x, y: ctx.y - headerHeight, width: labelColWidth, height: headerHeight, color: LABEL_BG, borderColor: BORDER, borderWidth: 0.5 });
    headerLabel.forEach((line, lineIndex) => {
      ctx.page.drawText(line, { x: x + 4, y: ctx.y - 13 - lineIndex * 10, size: 8, font: ctx.bold, color: TEXT_DARK });
    });
    x += labelColWidth;
  }
  headerLines.forEach((lines, i) => {
    ctx.page.drawRectangle({ x, y: ctx.y - headerHeight, width: colWidth, height: headerHeight, color: LABEL_BG, borderColor: BORDER, borderWidth: 0.5 });
    if (lines.length === 1) {
      ctx.page.drawText(lines[0]!, { x: x + 4, y: ctx.y - 13, size: 8, font: ctx.bold, color: TEXT_DARK });
    } else {
      lines.forEach((line, lineIndex) => {
        ctx.page.drawText(line, { x: x + 4, y: ctx.y - 11 - lineIndex * 10, size: 8, font: ctx.bold, color: TEXT_DARK });
      });
    }
    x += colWidth;
  });
  ctx.y -= headerHeight;

  for (let r = 0; r < rowCount; r++) {
    const row = rows[r] ?? {};
    const besideLines = columns.reduce((count, col) => count + (col.beside?.choices.length ?? 0), 0);
    const optionLines = Math.max(0, ...columns.map((col) => (col.kind === "checkboxGroup" ? (col.options?.length ?? 0) : 0)));
    const labelLines = hasLabelColumn
      ? fitTextLines(pdfSafe(fixedRowLabels?.[r] ?? ""), ctx.bold, 7.5, Math.max(8, labelColWidth - 8)).slice(0, 8)
      : [];
    const valueLines = columns.map((col) => {
      if (col.kind === "checkboxGroup") return [] as string[];
      const value = measuredCellValue(col.formula, row, fmeaCellValue(col.formula, row, row[col.key]));
      if (value == null || value === "") return [] as string[];
      return fitTextLines(pictureTextToPlain(pdfSafe(String(value))), ctx.font, 8, Math.max(8, colWidth - 8)).slice(0, 8);
    });
    const textLineCount = Math.max(1, labelLines.length, ...valueLines.map((lines) => lines.length));
    const textHeight = textLineCount <= 2 ? 32 : textLineCount * 10 + 8;
    const rowHeight = besideLines > 0 ? Math.max(32, textHeight, (optionLines + besideLines) * 11 + 6) : textHeight;
    ensureSpace(ctx, rowHeight);

    x = MARGIN;
    if (hasLabelColumn) {
      ctx.page.drawRectangle({ x, y: ctx.y - rowHeight, width: labelColWidth, height: rowHeight, color: LABEL_BG, borderColor: BORDER, borderWidth: 0.5 });
      labelLines.forEach((line, i) =>
        ctx.page.drawText(line, { x: x + 4, y: ctx.y - 12 - i * 9, size: 7.5, font: ctx.bold, color: TEXT_DARK })
      );
      x += labelColWidth;
    }

    for (const col of columns) {
      const value = measuredCellValue(col.formula, row, fmeaCellValue(col.formula, row, row[col.key]));
      const tone = fmeaComputedTone(col.formula, value);
      const palette = tone ? FMEA_PDF_TONE[tone] : col.kind === "computed" ? passFailPdfPalette(value) : null;
      ctx.page.drawRectangle({
        x,
        y: ctx.y - rowHeight,
        width: colWidth,
        height: rowHeight,
        color: palette ? rgb(palette.bg[0], palette.bg[1], palette.bg[2]) : WHITE,
        borderColor: BORDER,
        borderWidth: 0.5,
      });
      const textColor = palette ? rgb(palette.fg[0], palette.fg[1], palette.fg[2]) : TEXT_DARK;

      if (col.kind === "checkboxGroup") {
        const selected = (row[col.key] as Record<string, boolean> | undefined) ?? {};
        let line = 0;
        for (const opt of col.options ?? []) {
          const parentOn = Boolean(selected[opt]);
          drawCheckbox(ctx, x + 4, ctx.y - 11 - line * 11, parentOn);
          ctx.page.drawText(opt, { x: x + 15, y: ctx.y - 10 - line * 11, size: 7, font: ctx.font, color: TEXT_DARK });
          line += 1;
          if (col.beside?.option === opt) {
            for (const choice of col.beside.choices) {
              drawCheckbox(ctx, x + 16, ctx.y - 11 - line * 11, parentOn && Boolean(selected[choice]));
              ctx.page.drawText(choice, { x: x + 27, y: ctx.y - 10 - line * 11, size: 7, font: ctx.font, color: TEXT_DARK });
              line += 1;
            }
          }
        }
      } else if (value != null && value !== "") {
        const lines = valueLines[columns.indexOf(col)] ?? [];
        lines.forEach((line, i) => ctx.page.drawText(line, { x: x + 4, y: ctx.y - 12 - i * 10, size: 8, font: ctx.font, color: textColor }));
      }
      x += colWidth;
    }

    ctx.y -= rowHeight;
  }

  if (legend) {
    const lines = wrapText(pdfSafe(legend), ctx.italic, 8, contentWidth(ctx));
    ensureSpace(ctx, lines.length * 11 + 8);
    ctx.y -= 8;
    lines.forEach((line, i) => {
      ctx.page.drawText(line, { x: MARGIN, y: ctx.y - i * 11, size: 8, font: ctx.italic, color: TEXT_HINT });
    });
    ctx.y -= lines.length * 11;
  }
}

/** Helvetica is WinAnsi. An em dash in a column label must not abort the export. */
function pdfSafe(text: string): string {
  return text.replace(/\u2014/g, "-").replace(/\u2013/g, "-");
}

/** WinAnsi-safe clip. The ellipsis glyph is not in Helvetica and would abort the export. */
export function clipText(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  const ellipsis = "...";
  let result = text;
  while (result.length > 0 && font.widthOfTextAtSize(`${result}${ellipsis}`, size) > maxWidth) {
    result = result.slice(0, -1);
  }
  return result ? `${result}${ellipsis}` : "";
}

/** Wrap, then keep every line inside maxWidth. A single long word is clipped. */
export function fitTextLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  return wrapText(text, font, size, maxWidth).map((line) => clipText(line, font, size, maxWidth));
}

/** Greedy word-wrap to a max pixel width for the given font/size. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

export function truncate(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}…`, size) > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}
