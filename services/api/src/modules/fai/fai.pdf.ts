import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { passFailPaint } from "../../utils/passFail.js";
import { formalDate, limitsLabel, type CharacteristicMode } from "./fai.logic.js";

export interface FaiPdfLine {
  balloon: string | null;
  name: string;
  mode: CharacteristicMode;
  nominal: string | null;
  percent: string | null;
  plusTolerance: string | null;
  minusTolerance: string | null;
  limitLow: string | null;
  limitHigh: string | null;
  actual: string | null;
  attributeResult: string | null;
  result: string | null;
}

export interface FaiPdfModel {
  number: string;
  partNumber: string;
  partName: string | null;
  supplierName: string;
  planName: string;
  planRevision: number;
  outcome: string;
  comments: string | null;
  qualitySignature: string | null;
  decidedOn: string | null;
  ncrNumber: string | null;
  lines: FaiPdfLine[];
}

function paint(result: string | null): { bg: ReturnType<typeof rgb>; fg: ReturnType<typeof rgb> } | null {
  const colors = passFailPaint(result ?? "");
  if (!colors) return null;
  const unit = (hex: string) => {
    const n = Number.parseInt(hex.slice(1), 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  };
  return { bg: unit(colors.bg), fg: unit(colors.fg) };
}

function clip(text: string, width: number, size: number, font: { widthOfTextAtSize: (t: string, s: number) => number }): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let out = text;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}…`, size) > width) out = out.slice(0, -1);
  return `${out}…`;
}

/** One PDF for a finished first article: characteristics, limits, actuals, signer, and outcome. */
export async function renderFaiPdf(model: FaiPdfModel): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 792;
  const pageHeight = 612;
  const margin = 36;
  const columns = [
    { title: "Balloon", width: 58 },
    { title: "Characteristic", width: 160 },
    { title: "Nominal", width: 70 },
    { title: "Limits", width: 220 },
    { title: "Actual", width: 80 },
    { title: "Pass / Fail", width: 72 },
  ];
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  function newPage() {
    page = doc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  }

  function line(text: string, size: number, useBold = false) {
    if (y < margin + 20) newPage();
    page.drawText(text, { x: margin, y, size, font: useBold ? bold : font, color: rgb(0.1, 0.1, 0.1) });
    y -= size + 6;
  }

  line(model.number, 16, true);
  line("First Article Inspection", 12, true);
  line(`Part ${model.partNumber}${model.partName ? ` — ${model.partName}` : ""}`, 10);
  line(`Supplier ${model.supplierName}`, 10);
  line(`Plan ${model.planName}, revision ${model.planRevision}`, 10);
  line(`Outcome ${model.outcome}`, 10, true);
  if (model.decidedOn) line(`Decision date ${formalDate(model.decidedOn)}`, 10);
  if (model.ncrNumber) line(`Nonconformance ${model.ncrNumber}`, 10);
  line(`Signed ${model.qualitySignature?.replace(/\s+/g, " ") || "—"}`, 9);
  if (model.comments) line(`Comments ${model.comments}`, 9);
  y -= 8;

  function drawHeader() {
    if (y < margin + 36) newPage();
    let x = margin;
    const top = y + 12;
    page.drawRectangle({ x: margin, y: y - 4, width: tableWidth, height: 18, color: rgb(0.9, 0.91, 0.93) });
    for (const column of columns) {
      page.drawText(column.title, { x: x + 3, y, size: 8, font: bold, color: rgb(0.1, 0.1, 0.1) });
      x += column.width;
    }
    y = top - 22;
  }

  drawHeader();
  for (const row of model.lines) {
    if (y < margin + 16) {
      newPage();
      drawHeader();
    }
    const limits = limitsLabel(row);
    const actual = row.mode === "attribute" ? row.attributeResult || "" : row.actual || "";
    const cells = [row.balloon || "", row.name, row.nominal || "", limits, actual, row.result || ""];
    let x = margin;
    const resultPaint = paint(row.result);
    if (resultPaint) {
      const resultX = margin + columns.slice(0, 5).reduce((sum, column) => sum + column.width, 0);
      page.drawRectangle({ x: resultX, y: y - 3, width: columns[5]!.width, height: 14, color: resultPaint.bg });
    }
    cells.forEach((value, index) => {
      const column = columns[index]!;
      const color = index === 5 && resultPaint ? resultPaint.fg : rgb(0.1, 0.1, 0.1);
      page.drawText(clip(value, column.width - 6, 8, font), { x: x + 3, y, size: 8, font, color });
      x += column.width;
    });
    y -= 16;
  }

  return doc.save();
}
