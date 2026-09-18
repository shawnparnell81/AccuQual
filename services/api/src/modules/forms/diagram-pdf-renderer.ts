import { StandardFonts } from "pdf-lib";
import type { FormLayout } from "./layouts/types.js";
import {
  MARGIN,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  CONTENT_WIDTH,
  ensureSpace,
  drawTitle,
  drawSectionHeader,
  drawBlock,
  truncate,
  type RenderContext,
} from "./schema-pdf-renderer.js";

/**
 * Process Flow Diagram — PDF export. Same `data.diagram`/`data.steps` shape
 * as the frontend's `processFlowDiagram/diagramTypes.ts` (duplicated here,
 * not imported — this repo has no shared package between apps/web and
 * services/api yet, same tradeoff as the layouts/*.ts files themselves; see
 * that file's own comment).
 */
interface DiagramNodePosition {
  x: number;
  y: number;
  manual: boolean;
}
interface DiagramEdge {
  id: string;
  from: string;
  to: string;
  branchLabel?: string;
}
interface DiagramState {
  nodes: Record<string, DiagramNodePosition>;
  edges: DiagramEdge[];
}
interface ProcessStepRow {
  _diagramId?: string;
  opNo?: string;
  stepType?: string;
  processDescription?: string;
  [key: string]: unknown;
}

function isRealStep(row: ProcessStepRow): boolean {
  return Boolean(row.opNo?.trim() || row.processDescription?.trim());
}

const NODE_R = 20;
const MAX_DIAGRAM_H = 260;
const TEXT_HINT_GRAY = 0.42;

export async function renderProcessFlowDiagramAsPdf(layout: FormLayout, data: Record<string, unknown>): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import("pdf-lib");
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
      if (block.type === "table" && block.name === "steps") {
        drawDiagram(ctx, data, rgb);
      } else {
        drawBlock(ctx, block, data);
      }
    }
    ctx.y -= 10;
  }

  return doc.save();
}

function drawDiagram(ctx: RenderContext, data: Record<string, unknown>, rgb: (r: number, g: number, b: number) => import("pdf-lib").Color) {
  const steps = ((data.steps as ProcessStepRow[] | undefined) ?? []).filter((s) => isRealStep(s) && s._diagramId);
  const diagram = (data.diagram as DiagramState | undefined) ?? { nodes: {}, edges: [] };
  const stepById = new Map(steps.map((s) => [s._diagramId as string, s]));
  const positions = Object.entries(diagram.nodes).filter(([id]) => stepById.has(id));

  const hint = rgb(TEXT_HINT_GRAY, 0.45, 0.5);
  const dark = rgb(0.13, 0.13, 0.15);

  if (positions.length === 0) {
    ensureSpace(ctx, 20);
    ctx.page.drawText("No diagram yet — add process steps below to generate one.", { x: MARGIN, y: ctx.y - 14, size: 8.5, font: ctx.italic, color: hint });
    ctx.y -= 20;
    return;
  }

  const xs = positions.map(([, p]) => p.x);
  const ys = positions.map(([, p]) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const srcW = Math.max(1, maxX - minX);
  const srcH = Math.max(1, maxY - minY);

  const padding = NODE_R + 24;
  const availableW = CONTENT_WIDTH - padding * 2;
  const availableH = MAX_DIAGRAM_H - padding * 2;
  const scale = Math.min(availableW / srcW, availableH / srcH, 1.2);
  const diagramH = srcH * scale + padding * 2 + 22; // +22 for the description line under each node

  ensureSpace(ctx, diagramH);
  const originX = MARGIN + padding - minX * scale;
  const topY = ctx.y - padding;
  const toPdf = (p: { x: number; y: number }) => ({ x: originX + p.x * scale, y: topY - (p.y - minY) * scale });
  const r = Math.max(8, NODE_R * scale);

  // Merge affordance is purely structural — derived live from edges, matching DiagramCanvas.tsx's own client-side render.
  const incomingCount = new Map<string, number>();
  for (const e of diagram.edges) incomingCount.set(e.to, (incomingCount.get(e.to) ?? 0) + 1);

  for (const edge of diagram.edges) {
    const fromPos = diagram.nodes[edge.from];
    const toPos = diagram.nodes[edge.to];
    if (!fromPos || !toPos || !stepById.has(edge.from) || !stepById.has(edge.to)) continue;
    const from = toPdf(fromPos);
    const to = toPdf(toPos);
    const dx = to.x - from.x || 1;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    const x1 = from.x + ux * r;
    const y1 = from.y + uy * r;
    const headLen = 7;
    const tipX = to.x - ux * r;
    const tipY = to.y - uy * r;

    ctx.page.drawLine({ start: { x: x1, y: y1 }, end: { x: tipX, y: tipY }, thickness: 1.1, color: hint });

    // Arrowhead as a small filled triangle. drawSvgPath's local path coordinates are
    // y-DOWN (pdf-lib flips them to match the page's y-up space around the given x,y
    // anchor — see schema-pdf-renderer's callers and pdf-lib's operations.js comment
    // "SVG path Y axis is opposite pdf-lib's"), so a PDF-space (y-up) offset of dy
    // becomes a local path y-offset of -dy.
    const perpX = -uy;
    const perpY = ux;
    const backX = tipX - ux * headLen;
    const backY = tipY - uy * headLen;
    const c1 = { x: backX + perpX * 4 - tipX, y: -(backY + perpY * 4 - tipY) };
    const c2 = { x: backX - perpX * 4 - tipX, y: -(backY - perpY * 4 - tipY) };
    ctx.page.drawSvgPath(`M0,0 L${c1.x},${c1.y} L${c2.x},${c2.y} Z`, { x: tipX, y: tipY, color: hint });

    if (edge.branchLabel) {
      const midX = (x1 + tipX) / 2;
      const midY = (y1 + tipY) / 2;
      ctx.page.drawText(edge.branchLabel, { x: midX - 4, y: midY + 4, size: 7, font: ctx.italic, color: hint });
    }
  }

  for (const [id, pos] of positions) {
    const step = stepById.get(id)!;
    const p = toPdf(pos);
    drawNodeShape(ctx, step.stepType, p.x, p.y, r, dark, rgb);

    if ((incomingCount.get(id) ?? 0) >= 2) {
      ctx.page.drawEllipse({ x: p.x, y: p.y + r, xScale: 2, yScale: 2, color: dark });
    }

    const opLabel = step.opNo || "—";
    const opWidth = ctx.bold.widthOfTextAtSize(opLabel, 7.5);
    ctx.page.drawText(opLabel, { x: p.x - opWidth / 2, y: p.y - 3, size: 7.5, font: ctx.bold, color: dark });

    const desc = truncate(String(step.processDescription ?? ""), ctx.font, 7, availableW / Math.max(1, positions.length) + 20);
    const descWidth = ctx.font.widthOfTextAtSize(desc, 7);
    ctx.page.drawText(desc, { x: p.x - descWidth / 2, y: p.y - r - 12, size: 7, font: ctx.font, color: dark });
  }

  ctx.y -= diagramH;
}

function drawNodeShape(
  ctx: RenderContext,
  stepType: string | undefined,
  cx: number,
  cy: number,
  r: number,
  color: import("pdf-lib").Color,
  rgb: (red: number, g: number, b: number) => import("pdf-lib").Color
) {
  const white = rgb(1, 1, 1);
  switch (stepType) {
    case "Inspection":
      ctx.page.drawRectangle({ x: cx - r, y: cy - r, width: 2 * r, height: 2 * r, borderColor: color, borderWidth: 1.5, color: white });
      return;
    case "Op / Insp": {
      ctx.page.drawEllipse({ x: cx, y: cy, xScale: r, yScale: r, borderColor: color, borderWidth: 1.5, color: white });
      const inner = r * 0.55;
      ctx.page.drawRectangle({ x: cx - inner, y: cy - inner, width: 2 * inner, height: 2 * inner, borderColor: color, borderWidth: 1.2 });
      return;
    }
    case "Transport":
      // Local path is y-down relative to (cx,cy) — same convention as DiagramNodeShape.tsx's own formula.
      ctx.page.drawSvgPath(`M${-r * 0.75},${-r} L${r},0 L${-r * 0.75},${r} Z`, { x: cx, y: cy, color: white, borderColor: color, borderWidth: 1.5 });
      return;
    case "Delay": {
      // pdf-lib has no per-corner border radius — approximate the "D" (flat
      // left, rounded right) as a full circle with its left half squared
      // off: draw the circle, paint over the left hemisphere in white
      // (removing that half's fill+border), then draw the 3 straight edges
      // that close the flat-left boundary.
      ctx.page.drawEllipse({ x: cx, y: cy, xScale: r, yScale: r, color: white, borderColor: color, borderWidth: 1.5 });
      ctx.page.drawRectangle({ x: cx - r - 1, y: cy - r - 1, width: r + 1, height: 2 * r + 2, color: white });
      ctx.page.drawLine({ start: { x: cx - r, y: cy - r }, end: { x: cx - r, y: cy + r }, thickness: 1.5, color });
      ctx.page.drawLine({ start: { x: cx - r, y: cy - r }, end: { x: cx, y: cy - r }, thickness: 1.5, color });
      ctx.page.drawLine({ start: { x: cx - r, y: cy + r }, end: { x: cx, y: cy + r }, thickness: 1.5, color });
      return;
    }
    case "Storage":
      ctx.page.drawSvgPath(`M${-r},${-r} L${r},${-r} L0,${r} Z`, { x: cx, y: cy, color: white, borderColor: color, borderWidth: 1.5 });
      return;
    case "Decision":
      ctx.page.drawSvgPath(`M0,${-r} L${r},0 L0,${r} L${-r},0 Z`, { x: cx, y: cy, color: white, borderColor: color, borderWidth: 1.5 });
      return;
    case "Other":
      ctx.page.drawRectangle({ x: cx - r, y: cy - r, width: 2 * r, height: 2 * r, borderColor: color, borderWidth: 1.5, color: white });
      return;
    case "Operation":
    default:
      ctx.page.drawEllipse({ x: cx, y: cy, xScale: r, yScale: r, borderColor: color, borderWidth: 1.5, color: white });
      return;
  }
}
