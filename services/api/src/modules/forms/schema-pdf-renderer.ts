import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Block, FormLayout, TableColumn } from "./layouts/types.js";

// Colors sampled from the reference templates (dark navy header bars, pale
// blue-gray field boxes, thin blue-gray borders) — kept as named constants so
// every form drawn through this renderer looks like the same document family.
const NAVY = rgb(0.114, 0.227, 0.361);
const LABEL_BG = rgb(0.933, 0.961, 0.984);
const BORDER = rgb(0.788, 0.847, 0.906);
const TEXT_DARK = rgb(0.13, 0.13, 0.15);
const TEXT_HINT = rgb(0.42, 0.45, 0.5);
const WHITE = rgb(1, 1, 1);

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

interface RenderContext {
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

  const ctx: RenderContext = { doc, page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]), y: PAGE_HEIGHT - MARGIN, font, bold, italic };

  drawTitle(ctx, layout.title);

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

function ensureSpace(ctx: RenderContext, needed: number) {
  if (ctx.y - needed < MARGIN) {
    ctx.page = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    ctx.y = PAGE_HEIGHT - MARGIN;
  }
}

function drawTitle(ctx: RenderContext, title: string) {
  const lines = wrapText(title, ctx.bold, 16, CONTENT_WIDTH);
  for (const line of lines) {
    const width = ctx.bold.widthOfTextAtSize(line, 16);
    ctx.page.drawText(line, { x: MARGIN + (CONTENT_WIDTH - width) / 2, y: ctx.y, size: 16, font: ctx.bold, color: NAVY });
    ctx.y -= 20;
  }
  ctx.y -= 8;
}

function drawSectionHeader(ctx: RenderContext, text: string) {
  const height = 20;
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - height, width: CONTENT_WIDTH, height, color: NAVY });
  ctx.page.drawText(text, { x: MARGIN + 8, y: ctx.y - height + 6, size: 10.5, font: ctx.bold, color: WHITE });
  ctx.y -= height;
}

function drawBlock(ctx: RenderContext, block: Block, data: Record<string, unknown>) {
  switch (block.type) {
    case "row":
      return drawRow(ctx, block.fields, data);
    case "textarea":
      return drawTextarea(ctx, block.name, block.label, block.hint, data);
    case "yesno":
      return drawYesNo(ctx, block.name, block.label, data);
    case "table":
      return drawTable(ctx, block.name, block.columns, data, block.fixedRowLabels, block.labelColumnHeader, block.minRows);
  }
}

function drawRow(ctx: RenderContext, fields: { name: string; label: string; hint?: string }[], data: Record<string, unknown>) {
  const height = fields.some((f) => f.hint) ? 34 : 26;
  ensureSpace(ctx, height);
  const pairWidth = CONTENT_WIDTH / fields.length;
  const labelWidth = pairWidth * 0.42;
  const valueWidth = pairWidth * 0.58;

  fields.forEach((field, i) => {
    const x = MARGIN + i * pairWidth;
    ctx.page.drawRectangle({ x, y: ctx.y - height, width: labelWidth, height, color: LABEL_BG, borderColor: BORDER, borderWidth: 0.5 });
    ctx.page.drawRectangle({ x: x + labelWidth, y: ctx.y - height, width: valueWidth, height, color: WHITE, borderColor: BORDER, borderWidth: 0.5 });
    ctx.page.drawText(field.label, { x: x + 4, y: ctx.y - 12, size: 8, font: ctx.bold, color: TEXT_DARK });
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

  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - headerHeight, width: CONTENT_WIDTH, height: headerHeight, color: LABEL_BG, borderColor: BORDER, borderWidth: 0.5 });
  ctx.page.drawText(label, { x: MARGIN + 4, y: ctx.y - 11, size: 8.5, font: ctx.bold, color: TEXT_DARK });
  if (hint) {
    ctx.page.drawText(hint, { x: MARGIN + 4, y: ctx.y - headerHeight + 6, size: 7, font: ctx.italic, color: TEXT_HINT });
  }
  ctx.y -= headerHeight;

  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - bodyHeight, width: CONTENT_WIDTH, height: bodyHeight, color: WHITE, borderColor: BORDER, borderWidth: 0.5 });
  const value = data[name];
  if (value != null && value !== "") {
    const lines = wrapText(String(value), ctx.font, 9, CONTENT_WIDTH - 12).slice(0, Math.floor(bodyHeight / 12));
    lines.forEach((line, i) => {
      ctx.page.drawText(line, { x: MARGIN + 6, y: ctx.y - 12 - i * 12, size: 9, font: ctx.font, color: TEXT_DARK });
    });
  }
  ctx.y -= bodyHeight;
}

function drawYesNo(ctx: RenderContext, name: string, label: string, data: Record<string, unknown>) {
  const height = 22;
  ensureSpace(ctx, height);
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - height, width: CONTENT_WIDTH, height, color: LABEL_BG, borderColor: BORDER, borderWidth: 0.5 });
  ctx.page.drawText(label, { x: MARGIN + 4, y: ctx.y - 14, size: 8.5, font: ctx.bold, color: TEXT_DARK });

  const value = String(data[name] ?? "").toLowerCase();
  const yesBoxX = MARGIN + CONTENT_WIDTH - 90;
  const noBoxX = MARGIN + CONTENT_WIDTH - 40;
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
  minRows: number | undefined
) {
  const rows = (data[name] as Record<string, unknown>[] | undefined) ?? [];
  const rowCount = fixedRowLabels ? fixedRowLabels.length : Math.max(rows.length, minRows ?? 1);

  const hasLabelColumn = Boolean(fixedRowLabels);
  const labelColWidth = hasLabelColumn ? CONTENT_WIDTH * 0.22 : 0;
  const remainingWidth = CONTENT_WIDTH - labelColWidth;
  const colWidth = remainingWidth / columns.length;

  const headerHeight = 18;
  ensureSpace(ctx, headerHeight);
  let x = MARGIN;
  if (hasLabelColumn) {
    ctx.page.drawRectangle({ x, y: ctx.y - headerHeight, width: labelColWidth, height: headerHeight, color: LABEL_BG, borderColor: BORDER, borderWidth: 0.5 });
    ctx.page.drawText(labelColumnHeader ?? "Role", { x: x + 4, y: ctx.y - 13, size: 8, font: ctx.bold, color: TEXT_DARK });
    x += labelColWidth;
  }
  for (const col of columns) {
    ctx.page.drawRectangle({ x, y: ctx.y - headerHeight, width: colWidth, height: headerHeight, color: LABEL_BG, borderColor: BORDER, borderWidth: 0.5 });
    ctx.page.drawText(col.label, { x: x + 4, y: ctx.y - 13, size: 8, font: ctx.bold, color: TEXT_DARK });
    x += colWidth;
  }
  ctx.y -= headerHeight;

  for (let r = 0; r < rowCount; r++) {
    const row = rows[r] ?? {};
    const rowHeight = 32;
    ensureSpace(ctx, rowHeight);

    x = MARGIN;
    if (hasLabelColumn) {
      ctx.page.drawRectangle({ x, y: ctx.y - rowHeight, width: labelColWidth, height: rowHeight, color: LABEL_BG, borderColor: BORDER, borderWidth: 0.5 });
      const label = fixedRowLabels?.[r] ?? "";
      wrapText(label, ctx.bold, 7.5, labelColWidth - 8).forEach((line, i) =>
        ctx.page.drawText(line, { x: x + 4, y: ctx.y - 12 - i * 9, size: 7.5, font: ctx.bold, color: TEXT_DARK })
      );
      x += labelColWidth;
    }

    for (const col of columns) {
      ctx.page.drawRectangle({ x, y: ctx.y - rowHeight, width: colWidth, height: rowHeight, color: WHITE, borderColor: BORDER, borderWidth: 0.5 });

      if (col.kind === "checkboxGroup") {
        const selected = (row[col.key] as Record<string, boolean> | undefined) ?? {};
        (col.options ?? []).forEach((opt, i) => {
          drawCheckbox(ctx, x + 4, ctx.y - 11 - i * 11, Boolean(selected[opt]));
          ctx.page.drawText(opt, { x: x + 15, y: ctx.y - 10 - i * 11, size: 7, font: ctx.font, color: TEXT_DARK });
        });
      } else {
        const value = row[col.key];
        if (value != null && value !== "") {
          wrapText(String(value), ctx.font, 8, colWidth - 8)
            .slice(0, 3)
            .forEach((line, i) => ctx.page.drawText(line, { x: x + 4, y: ctx.y - 12 - i * 10, size: 8, font: ctx.font, color: TEXT_DARK }));
        }
      }
      x += colWidth;
    }

    ctx.y -= rowHeight;
  }
}

/** Greedy word-wrap to a max pixel width for the given font/size. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
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

function truncate(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}…`, size) > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}
