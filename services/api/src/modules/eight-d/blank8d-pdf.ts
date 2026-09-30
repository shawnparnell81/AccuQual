import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { BLANK_8D_LABELS, BLANK_8D_STRING_KEYS, BLANK_8D_TITLE, type Blank8DValues } from "./blank8dForm.js";
import { pictureTextToPlain } from "../attachments/inlinePicture.js";
import { drawDmaLogo, embedDmaLogo } from "../branding/dmaLogo.js";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 28;
const MARGIN_Y = 22;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

const INK = rgb(0.133, 0.133, 0.133);
const LINE = rgb(0.15, 0.15, 0.15);
const HEADER = rgb(0.85, 0.85, 0.85);
const SHEET = rgb(0.93, 0.93, 0.93);
const WHITE = rgb(1, 1, 1);

/** Column shares of C through K on the Blank 8D sheet. */
const COLS = [0.1356, 0.2555, 0.0065, 0.1852, 0.0821, 0.0821, 0.0821, 0.0821, 0.0886];

interface Ctx {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  y: number;
}

function colX(index: number): number {
  let x = MARGIN_X;
  for (let i = 0; i < index; i++) x += CONTENT_W * COLS[i]!;
  return x;
}

function spanW(start: number, end: number): number {
  let w = 0;
  for (let i = start; i <= end; i++) w += CONTENT_W * COLS[i]!;
  return w;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function drawBox(ctx: Ctx, x: number, yTop: number, w: number, h: number, fill: typeof WHITE) {
  ctx.page.drawRectangle({ x, y: yTop - h, width: w, height: h, color: fill, borderColor: LINE, borderWidth: 0.6 });
}

function drawLines(ctx: Ctx, text: string, x: number, yTop: number, w: number, h: number, font: PDFFont, size: number, align: "left" | "center" | "right") {
  const lines = wrap(text, font, size, w - 6).slice(0, Math.max(1, Math.floor((h - 4) / (size + 1))));
  lines.forEach((line, i) => {
    const textW = font.widthOfTextAtSize(line, size);
    const tx = align === "center" ? x + (w - textW) / 2 : align === "right" ? x + w - textW - 3 : x + 3;
    ctx.page.drawText(line, { x: tx, y: yTop - size - 3 - i * (size + 1), size, font, color: INK });
  });
}

function labelCell(ctx: Ctx, col: number, span: number, h: number, text: string, opts?: { size?: number; align?: "left" | "center" | "right"; bold?: boolean }) {
  const x = colX(col);
  const w = spanW(col, col + span - 1);
  drawBox(ctx, x, ctx.y, w, h, SHEET);
  drawLines(ctx, text, x, ctx.y, w, h, opts?.bold ? ctx.bold : ctx.font, opts?.size ?? 8, opts?.align ?? "right");
}

function valueCell(ctx: Ctx, col: number, span: number, h: number, text: string, align: "left" | "center" = "center") {
  const x = colX(col);
  const w = spanW(col, col + span - 1);
  drawBox(ctx, x, ctx.y, w, h, WHITE);
  if (text) drawLines(ctx, text, x, ctx.y, w, h, ctx.font, 8, align);
}

function headerRow(ctx: Ctx, h: number, cells: { col: number; span: number; text: string; kind: "label" | "value"; size?: number; align?: "left" | "center" | "right" }[]) {
  for (const cell of cells) {
    if (cell.kind === "label") labelCell(ctx, cell.col, cell.span, h, cell.text, { size: cell.size, align: cell.align });
    else valueCell(ctx, cell.col, cell.span, h, cell.text, cell.align === "left" ? "left" : "center");
  }
  ctx.y -= h + 3;
}

function sectionBar(ctx: Ctx, h: number, parts: { col: number; span: number; text: string; size?: number; align?: "left" | "center" }[]) {
  for (const part of parts) {
    const x = colX(part.col);
    const w = spanW(part.col, part.col + part.span - 1);
    drawBox(ctx, x, ctx.y, w, h, HEADER);
    drawLines(ctx, part.text, x, ctx.y, w, h, ctx.bold, part.size ?? 8, part.align ?? "left");
  }
  ctx.y -= h;
}

function narrative(ctx: Ctx, col: number, span: number, h: number, text: string) {
  const x = colX(col);
  const w = spanW(col, col + span - 1);
  drawBox(ctx, x, ctx.y, w, h, WHITE);
  if (text) drawLines(ctx, text, x, ctx.y, w, h, ctx.font, 8, "left");
}

function check(ctx: Ctx, x: number, y: number, on: boolean) {
  ctx.page.drawRectangle({ x, y, width: 8, height: 8, borderColor: LINE, borderWidth: 0.7, color: WHITE });
  if (on) {
    ctx.page.drawLine({ start: { x: x + 1.5, y: y + 4 }, end: { x: x + 3.2, y: y + 1.6 }, thickness: 1, color: INK });
    ctx.page.drawLine({ start: { x: x + 3.2, y: y + 1.6 }, end: { x: x + 6.6, y: y + 6.4 }, thickness: 1, color: INK });
  }
}

export async function renderBlank8DPdf(input: { id: number; values: Blank8DValues }): Promise<Uint8Array> {
  const v = { ...input.values };
  for (const key of BLANK_8D_STRING_KEYS) v[key] = pictureTextToPlain(input.values[key]);
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = { page, font, bold, y: PAGE_H - MARGIN_Y };
  const L = BLANK_8D_LABELS;

  page.drawRectangle({ x: MARGIN_X - 4, y: MARGIN_Y - 4, width: CONTENT_W + 8, height: PAGE_H - MARGIN_Y * 2 + 8, color: SHEET, borderColor: LINE, borderWidth: 0.8 });

  const titleH = 26;
  drawBox(ctx, MARGIN_X, ctx.y, CONTENT_W, titleH, WHITE);
  const logo = await embedDmaLogo(doc);
  drawDmaLogo(page, logo, MARGIN_X + 3, ctx.y - 2, 22);
  const title = BLANK_8D_TITLE;
  const titleW = bold.widthOfTextAtSize(title, 16);
  page.drawText(title, { x: MARGIN_X + (CONTENT_W - titleW) / 2, y: ctx.y - 18, size: 16, font: bold, color: INK });
  ctx.y -= titleH + 6;

  const rowH = 16;
  headerRow(ctx, rowH, [
    { col: 0, span: 3, text: L.whoImpacted, kind: "label", align: "left" },
    { col: 3, span: 1, text: L.dateOpen, kind: "label" },
    { col: 4, span: 2, text: v.dateOpen, kind: "value" },
    { col: 6, span: 1, text: L.eightDNo, kind: "label" },
    { col: 7, span: 2, text: String(input.id), kind: "value", align: "left" },
  ]);
  headerRow(ctx, rowH, [
    { col: 0, span: 1, text: L.customer, kind: "label" },
    { col: 1, span: 2, text: v.customer, kind: "value" },
    { col: 3, span: 1, text: L.initialResponse, kind: "label" },
    { col: 4, span: 2, text: v.initialResponse, kind: "value" },
    { col: 6, span: 1, text: L.customerComplaintNo, kind: "label", size: 6 },
    { col: 7, span: 2, text: v.customerComplaintNo, kind: "value" },
  ]);
  headerRow(ctx, rowH, [
    { col: 0, span: 1, text: L.address, kind: "label" },
    { col: 1, span: 2, text: v.address, kind: "value" },
    { col: 3, span: 1, text: L.targetCloseDate, kind: "label" },
    { col: 4, span: 5, text: v.targetCloseDate, kind: "value" },
  ]);
  headerRow(ctx, rowH, [
    { col: 0, span: 1, text: L.location, kind: "label" },
    { col: 1, span: 2, text: v.location, kind: "value" },
    { col: 3, span: 1, text: L.revisionDates, kind: "label" },
    { col: 4, span: 5, text: v.revisionDates, kind: "value" },
  ]);
  headerRow(ctx, rowH, [
    { col: 0, span: 1, text: L.partNo, kind: "label" },
    { col: 1, span: 2, text: v.partNo, kind: "value" },
    { col: 3, span: 1, text: L.initiator, kind: "label" },
    { col: 4, span: 5, text: v.initiator, kind: "value" },
  ]);
  headerRow(ctx, rowH, [
    { col: 0, span: 1, text: L.productName, kind: "label" },
    { col: 1, span: 2, text: v.productName, kind: "value" },
    { col: 3, span: 1, text: L.initiatorSupervisor, kind: "label" },
    { col: 4, span: 5, text: v.initiatorSupervisor, kind: "value" },
  ]);

  const impactH = 16;
  const impactX = colX(0);
  const impactW = spanW(0, 2);
  drawBox(ctx, impactX, ctx.y, impactW, impactH, SHEET);
  check(ctx, impactX + 6, ctx.y - 12, v.impactedInternal);
  page.drawText(L.impactedInternal, { x: impactX + 18, y: ctx.y - 11, size: 8, font, color: INK });
  page.drawText(L.impactedOr, { x: impactX + 72, y: ctx.y - 11, size: 8, font, color: INK });
  check(ctx, impactX + 88, ctx.y - 12, v.impactedExternal);
  page.drawText(L.impactedExternal, { x: impactX + 100, y: ctx.y - 11, size: 8, font, color: INK });
  labelCell(ctx, 3, 1, impactH, L.actualCloseDate);
  valueCell(ctx, 4, 5, impactH, v.actualCloseDate);
  ctx.y -= impactH + 4;

  const splitHead = 14;
  sectionBar(ctx, splitHead, [
    { col: 0, span: 3, text: L.d1 },
    { col: 3, span: 6, text: L.d2 },
  ]);
  const teamH = 14;
  const problemH = teamH * 3 + 4;
  const problemTop = ctx.y;
  for (const [label, value] of [
    [L.champion, v.champion],
    [L.teamLeader, v.teamLeader],
    [L.teamMembers, v.teamMembers],
  ] as const) {
    labelCell(ctx, 0, 1, teamH, label, { align: "left" });
    valueCell(ctx, 1, 2, teamH, value, "left");
    ctx.y -= teamH + 2;
  }
  const saved = ctx.y;
  ctx.y = problemTop;
  narrative(ctx, 3, 6, problemH, v.problemStatement);
  ctx.y = Math.min(saved, problemTop - problemH) - 4;

  const barH = 16;
  const bodyH = 64;
  sectionBar(ctx, barH, [
    { col: 0, span: 6, text: L.d3 },
    { col: 6, span: 1, text: L.percentEffective, size: 7, align: "center" },
    { col: 7, span: 1, text: L.targetDate, size: 7, align: "center" },
    { col: 8, span: 1, text: L.actualDate, size: 7, align: "center" },
  ]);
  narrative(ctx, 0, 6, bodyH, v.ica);
  valueCell(ctx, 6, 1, bodyH, v.icaPercentEffective);
  valueCell(ctx, 7, 1, bodyH, v.icaTargetDate, "left");
  valueCell(ctx, 8, 1, bodyH, v.icaActualDate, "left");
  ctx.y -= bodyH + 3;

  sectionBar(ctx, barH, [
    { col: 0, span: 7, text: L.d4 },
    { col: 7, span: 2, text: L.percentContribution, align: "center" },
  ]);
  narrative(ctx, 0, 7, bodyH, v.rootCauses);
  valueCell(ctx, 7, 2, bodyH, v.rootCausePercentContribution);
  ctx.y -= bodyH + 3;

  sectionBar(ctx, barH, [
    { col: 0, span: 7, text: L.d5 },
    { col: 7, span: 2, text: L.percentEffective, align: "center" },
  ]);
  narrative(ctx, 0, 7, bodyH, v.pca);
  valueCell(ctx, 7, 2, bodyH, v.pcaPercentEffective);
  ctx.y -= bodyH + 3;

  sectionBar(ctx, barH, [
    { col: 0, span: 7, text: L.d6 },
    { col: 7, span: 1, text: L.targetDate, size: 7, align: "center" },
    { col: 8, span: 1, text: L.actualDate, size: 7, align: "center" },
  ]);
  narrative(ctx, 0, 7, bodyH, v.implementation);
  valueCell(ctx, 7, 1, bodyH, v.implementationTargetDate, "left");
  valueCell(ctx, 8, 1, bodyH, v.implementationActualDate, "left");
  ctx.y -= bodyH + 3;

  const d7h = 22;
  sectionBar(ctx, d7h, [
    { col: 0, span: 5, text: L.d7, size: 7.5 },
    { col: 5, span: 2, text: L.mistakeProofing, size: 6.5 },
    { col: 7, span: 1, text: L.targetDate, size: 7, align: "center" },
    { col: 8, span: 1, text: L.actualDate, size: 7, align: "center" },
  ]);
  const d7body = 36;
  narrative(ctx, 0, 7, d7body, v.prevention);
  valueCell(ctx, 7, 1, d7body, v.preventionTargetDate, "left");
  valueCell(ctx, 8, 1, d7body, v.preventionActualDate, "left");
  ctx.y -= d7body + 3;

  sectionBar(ctx, barH, [{ col: 0, span: 9, text: L.documentsReviewed, align: "center" }]);
  const checkH = 16;
  drawBox(ctx, MARGIN_X, ctx.y, CONTENT_W, checkH, WHITE);
  page.drawText(L.checkBoxes, { x: MARGIN_X + 4, y: ctx.y - 11, size: 8, font, color: INK });
  const boxes: [boolean, string][] = [
    [v.reviewedControlPlan, L.controlPlan],
    [v.reviewedFmea, L.fmea],
    [v.reviewedFlowchart, L.flowchart],
    [v.reviewedProcWorkInstr, L.procWorkInstr],
    [v.reviewedInternalAudit, L.internalAudit],
  ];
  let bx = MARGIN_X + 130;
  for (const [on, label] of boxes) {
    check(ctx, bx, ctx.y - 12, on);
    page.drawText(label, { x: bx + 11, y: ctx.y - 11, size: 7.5, font, color: INK });
    bx += font.widthOfTextAtSize(label, 7.5) + 22;
  }
  ctx.y -= checkH + 3;

  sectionBar(ctx, barH, [{ col: 0, span: 9, text: L.d8 }]);
  narrative(ctx, 0, 9, 28, v.recognition);

  return doc.save();
}
