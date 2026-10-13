/**
 * The Graphs tab of a validation workbook: a CTW run's header fields and its displacement/force points. Saved beside the
 * sheet's cells as data.graph; the chart is drawn from the points and prints with the report.
 */
export type GraphPoint = [number, number];

export interface GraphData {
  /** Run header fields by name (File, Run, Notes, ...). */
  fields: Record<string, string>;
  /** [displacement mm, force N] */
  points: GraphPoint[];
}

/** The most points one run may hold. The server enforces the same number. */
export const MAX_GRAPH_POINTS = 50000;
/** The most points the chart draws; a longer run is thinned for the picture only. The table and saved data keep every point. */
export const MAX_DRAWN_POINTS = 1500;

export function blankGraph(): GraphData {
  return { fields: {}, points: [] };
}

/** The graph a saved report holds, cleaned. Anything malformed is dropped. */
export function graphFromData(data: unknown): GraphData {
  const raw = data && typeof data === "object" ? (data as { graph?: unknown }).graph : undefined;
  if (!raw || typeof raw !== "object") return blankGraph();
  const { fields, points } = raw as { fields?: unknown; points?: unknown };
  const out = blankGraph();
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

export interface ParsedPoints {
  points: GraphPoint[];
  /** Lines that were not two numbers (a header row, a blank line, a stray note). */
  skipped: number;
  /** True when the text held more than MAX_GRAPH_POINTS and the rest was left off. */
  truncated: boolean;
}

/**
 * Two columns pasted from Excel or a CSV: the separator may be a tab, comma, semicolon or spaces. A line whose first two
 * values are not numbers (a header, a unit row) is skipped and counted.
 */
export function parsePoints(text: string): ParsedPoints {
  const points: GraphPoint[] = [];
  let skipped = 0;
  let truncated = false;
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (!line.trim()) continue;
    const parts = line.trim().split(/[\t,; ]+/).filter((part) => part !== "");
    const x = parts.length >= 2 ? Number(parts[0]) : Number.NaN;
    const y = parts.length >= 2 ? Number(parts[1]) : Number.NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      skipped += 1;
      continue;
    }
    if (points.length >= MAX_GRAPH_POINTS) {
      truncated = true;
      break;
    }
    points.push([x, y]);
  }
  return { points, skipped, truncated };
}

/** The points as tab-separated lines, ready to paste back into Excel. */
export function pointsToText(points: GraphPoint[]): string {
  return points.map(([x, y]) => `${x}\t${y}`).join("\n");
}

/** Thins a long run to at most `max` points for drawing, always keeping the first and the last. */
export function downsample(points: GraphPoint[], max = MAX_DRAWN_POINTS): GraphPoint[] {
  if (points.length <= max || max < 3) return points;
  const out: GraphPoint[] = [points[0]!];
  const step = (points.length - 1) / (max - 1);
  for (let i = 1; i < max - 1; i += 1) out.push(points[Math.round(i * step)]!);
  out.push(points[points.length - 1]!);
  return out;
}

/** True when two graphs hold the same fields and points (used to see what changed). */
export function sameGraph(a: GraphData, b: GraphData): boolean {
  if (a.points.length !== b.points.length) return false;
  for (let i = 0; i < a.points.length; i += 1) {
    if (a.points[i]![0] !== b.points[i]![0] || a.points[i]![1] !== b.points[i]![1]) return false;
  }
  const names = new Set([...Object.keys(a.fields), ...Object.keys(b.fields)]);
  for (const name of names) if ((a.fields[name] ?? "") !== (b.fields[name] ?? "")) return false;
  return true;
}

/** Whether the graph holds anything at all, for the saved payload and the dirty check. */
export function graphIsEmpty(graph: GraphData): boolean {
  return graph.points.length === 0 && Object.values(graph.fields).every((value) => !value.trim());
}
