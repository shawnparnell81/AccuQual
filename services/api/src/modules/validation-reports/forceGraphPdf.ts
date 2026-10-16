import { degrees, rgb, type PDFPage } from "pdf-lib";
import { MARGIN, ensureSpace, type RenderContext } from "../forms/schema-pdf-renderer.js";
import { MAX_GRAPH_POINTS } from "./validation-reports.validation.js";

/** The force chart on a validation form, as the app draws it (see the web GraphsPanel). */
export interface ForceGraphSpec {
  title: string;
  xLabel: string;
  yLabel: string;
  fields: string[];
}

const CTW_FIELDS = ["File", "Run", "Notes", "SpringFreeHeight", "ReportedRateEndPoint", "Rate", "SpringContactDisplacement", "ReportedRateStartPoint"];

/** Forms whose saved record carries displacement/force points (data.graph). Same titles and labels as on screen. */
export const FORCE_GRAPH_SPECS: Record<string, ForceGraphSpec> = {
  electric_lift: { title: "Force vs displacement", xLabel: "Displacement (mm)", yLabel: "Force (N)", fields: CTW_FIELDS },
  regular_gas_lift: { title: "Spring rate (CTW run)", xLabel: "Displacement (mm)", yLabel: "Force (N)", fields: CTW_FIELDS },
};

/** The most points drawn; a longer run is thinned for the picture only, the same way the screen does. */
export const MAX_DRAWN_POINTS = 1500;

export type GraphPoint = [number, number];
export interface GraphData {
  fields: Record<string, string>;
  points: GraphPoint[];
}

/** The graph a saved report holds, cleaned the same way the app reads it. */
export function graphFromData(data: unknown): GraphData {
  const out: GraphData = { fields: {}, points: [] };
  const raw = data && typeof data === "object" ? (data as { graph?: unknown }).graph : undefined;
  if (!raw || typeof raw !== "object") return out;
  const { fields, points } = raw as { fields?: unknown; points?: unknown };
  if (fields && typeof fields === "object" && !Array.isArray(fields)) {
    for (const [name, value] of Object.entries(fields as Record<string, unknown>)) {
      if (typeof value === "string") out.fields[name] = value;
      else if (typeof value === "number") out.fields[name] = String(value);
    }
  }
  if (Array.isArray(points)) {
    for (const point of points) {
      if (!Array.isArray(point) || point.length !== 2) continue;
      const [x, y] = point as unknown[];
      if (typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)) out.points.push([x, y]);
      if (out.points.length >= MAX_GRAPH_POINTS) break;
    }
  }
  return out;
}

/** Thins a long run to at most `max` points, keeping the first and last (same as the screen). */
export function downsample(points: GraphPoint[], max = MAX_DRAWN_POINTS): GraphPoint[] {
  if (points.length <= max || max < 3) return points;
  const out: GraphPoint[] = [points[0]!];
  const step = (points.length - 1) / (max - 1);
  for (let i = 1; i < max - 1; i += 1) out.push(points[Math.round(i * step)]!);
  out.push(points[points.length - 1]!);
  return out;
}

function formatStep(rough: number, correction: number): number {
  if (rough <= 0) return 1;
  const digitCount = Math.floor(Math.log10(Math.abs(rough))) + 1;
  const digitValue = 10 ** digitCount;
  const ratio = rough / digitValue;
  const scale = digitCount !== 1 ? 0.05 : 0.1;
  return Number(((Math.ceil(Number((ratio / scale).toPrecision(12))) + correction) * scale * digitValue).toPrecision(12));
}

function calculateStep(min: number, max: number, count: number, correction = 0): { step: number; tickMin: number; tickMax: number } {
  const step = formatStep((max - min) / (count - 1), correction);
  let middle: number;
  if (min <= 0 && max >= 0) middle = 0;
  else {
    middle = (min + max) / 2;
    middle = Number((middle - (middle % step)).toPrecision(12));
  }
  let below = Math.ceil(Number(((middle - min) / step).toPrecision(12)));
  let up = Math.ceil(Number(((max - middle) / step).toPrecision(12)));
  const scaleCount = below + up + 1;
  if (scaleCount > count) return calculateStep(min, max, count, correction + 1);
  if (scaleCount < count) {
    if (max > 0) up += count - scaleCount;
    else below += count - scaleCount;
  }
  return { step, tickMin: middle - below * step, tickMax: middle + up * step };
}

/**
 * Axis ticks for an automatic axis, the same way the on-screen chart picks them (five ticks, the same step rules), so
 * the downloaded chart has the same scale and gridlines as the screen.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min > max) [min, max] = [max, min];
  if (min === max) {
    // A single value: the screen centers it with steps of 1 (or of its own magnitude).
    const step = min === 0 ? 1 : 10 ** Math.floor(Math.log10(Math.abs(min)));
    const middle = Math.floor(min / step) * step;
    const half = Math.floor((count - 1) / 2);
    return Array.from({ length: count }, (_, i) => Number((middle + (i - half) * step).toPrecision(12)));
  }
  const { step, tickMin, tickMax } = calculateStep(min, max, Math.max(count, 2));
  const ticks: number[] = [];
  for (let v = tickMin; v <= tickMax + step * 0.1; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

function label(value: number): string {
  return Number(value.toPrecision(6)).toString();
}

function dashedLine(page: PDFPage, x1: number, y1: number, x2: number, y2: number) {
  page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.4, color: rgb(0.733, 0.733, 0.733), dashArray: [3, 3] });
}

const POINT = rgb(31 / 255, 95 / 255, 191 / 255);
const INK = rgb(0, 0, 0);

/** Draws the run header fields and the force chart from the saved points. */
export function drawForceGraph(ctx: RenderContext, spec: ForceGraphSpec, graph: GraphData): void {
  const width = ctx.page.getWidth() - MARGIN * 2;
  const fieldLines = Math.ceil(spec.fields.length / 4);
  ensureSpace(ctx, 30 + fieldLines * 24 + 300);
  const page = ctx.page;
  let y = ctx.y - 4;
  page.drawText(spec.title, { x: MARGIN, y: y - 11, size: 11, font: ctx.bold, color: INK });
  y -= 22;

  const colWidth = width / 4;
  spec.fields.forEach((name, i) => {
    const x = MARGIN + (i % 4) * colWidth;
    const rowY = y - Math.floor(i / 4) * 24;
    page.drawText(name, { x, y: rowY - 7, size: 7, font: ctx.font, color: rgb(0.35, 0.35, 0.35) });
    const value = (graph.fields[name] ?? "").trim() || "—";
    const fitted = value.length > 40 ? `${value.slice(0, 39)}…` : value;
    page.drawText(fitted, { x, y: rowY - 18, size: 8.5, font: ctx.font, color: INK });
  });
  y -= fieldLines * 24 + 6;

  const chartHeight = 260;
  const left = MARGIN + 46;
  const right = MARGIN + width - 12;
  const top = y - 8;
  const bottom = y - chartHeight + 34;
  const drawn = downsample(graph.points);

  if (drawn.length === 0) {
    page.drawRectangle({ x: left, y: bottom, width: right - left, height: top - bottom, borderColor: rgb(0.733, 0.733, 0.733), borderWidth: 0.5 });
    page.drawText("No points recorded.", { x: left + 8, y: (top + bottom) / 2, size: 9, font: ctx.italic, color: rgb(0.35, 0.35, 0.35) });
  } else {
    const xs = niceTicks(Math.min(...drawn.map((p) => p[0])), Math.max(...drawn.map((p) => p[0])));
    const ys = niceTicks(Math.min(...drawn.map((p) => p[1])), Math.max(...drawn.map((p) => p[1])));
    const x0 = xs[0]!, x1 = xs[xs.length - 1]!, y0 = ys[0]!, y1 = ys[ys.length - 1]!;
    const sx = (v: number) => left + ((v - x0) / (x1 - x0 || 1)) * (right - left);
    const sy = (v: number) => bottom + ((v - y0) / (y1 - y0 || 1)) * (top - bottom);
    for (const t of xs) {
      dashedLine(page, sx(t), bottom, sx(t), top);
      const text = label(t);
      page.drawText(text, { x: sx(t) - ctx.font.widthOfTextAtSize(text, 7.5) / 2, y: bottom - 11, size: 7.5, font: ctx.font, color: INK });
    }
    for (const t of ys) {
      dashedLine(page, left, sy(t), right, sy(t));
      const text = label(t);
      page.drawText(text, { x: left - 4 - ctx.font.widthOfTextAtSize(text, 7.5), y: sy(t) - 2.5, size: 7.5, font: ctx.font, color: INK });
    }
    page.drawLine({ start: { x: left, y: bottom }, end: { x: right, y: bottom }, thickness: 0.8, color: INK });
    page.drawLine({ start: { x: left, y: bottom }, end: { x: left, y: top }, thickness: 0.8, color: INK });
    for (const [px, py] of drawn) page.drawCircle({ x: sx(px), y: sy(py), size: 1.6, color: POINT });
  }
  const xLabelWidth = ctx.font.widthOfTextAtSize(spec.xLabel, 8.5);
  page.drawText(spec.xLabel, { x: (left + right) / 2 - xLabelWidth / 2, y: bottom - 25, size: 8.5, font: ctx.font, color: INK });
  page.drawText(spec.yLabel, { x: MARGIN + 12, y: (top + bottom) / 2 - ctx.font.widthOfTextAtSize(spec.yLabel, 8.5) / 2, size: 8.5, font: ctx.font, color: INK, rotate: degrees(90) });
  if (graph.points.length > 0) {
    const note = `${graph.points.length.toLocaleString("en-US")} points${graph.points.length > drawn.length ? `; the chart shows ${drawn.length.toLocaleString("en-US")} of them` : ""}.`;
    page.drawText(note, { x: left, y: bottom - 38, size: 7.5, font: ctx.font, color: rgb(0.35, 0.35, 0.35) });
  }
  ctx.y = y - chartHeight - 4;
}
