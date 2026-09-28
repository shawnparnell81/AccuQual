/** Scores and totals for the fillable ISO forms. */

export type CellValue = string | number | boolean | null;

export const AUDIT_RESULTS = ["Pass", "Minor NC", "Major NC"] as const;
export const YES_NO = ["YES", "NO"] as const;
export const YN = ["Y", "N"] as const;
export const COMPETENCY = ["1", "2", "3"] as const;

export const CROSS_CRITERIA = [
  { addr: "S1", section: "A", weight: 2, max: 20, text: "1. Development & Lifecycle: Did the engineer clearly explain how the product is developed, from initial specs to final validation?" },
  { addr: "S2", section: "A", weight: 2, max: 20, text: "2. Failure Modes & Quality Risks: Did the engineer thoroughly identify things to look out for (critical tolerances, common warranty issues, lab testing failure points)?" },
  { addr: "S3", section: "A", weight: 1, max: 10, text: "3. New Tech & Electrical Integration: Did the engineer successfully explain new technologies, electrical/sensor ties, or modern advancements in this product category?" },
  { addr: "S4", section: "B", weight: 2, max: 20, text: "4. QMS Documentation: Did the presenter explicitly reference internal ISO documents (SPEC target values, WIN testing methods, or FRM validation forms) to ground their presentation in official company standards?" },
  { addr: "S5", section: "C", weight: 2, max: 20, text: "5. Technical Defense: How accurately and confidently did the engineer answer ad-hoc technical questions from the technicians and peer engineers? Did they admit when they didn't know an answer, rather than guessing?" },
  { addr: "S6", section: "D", weight: 1, max: 10, text: "6. Clarity & Engagement: Was the presentation logical and easy to follow? Were visual aids (physical samples, CAD drawings, PowerPoint) effective in helping technicians understand the concepts?" },
] as const;

const QTY_CELLS = ["B17", "B18", "B19", "B20", "B21"];

function numberOrNull(value: CellValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function quarantineTotal(cells: Record<string, CellValue>): number | null {
  let total = 0;
  let any = false;
  for (const addr of QTY_CELLS) {
    const value = numberOrNull(cells[addr]);
    if (value == null) continue;
    total += value;
    any = true;
  }
  return any ? total : null;
}

export function scoreLine(value: CellValue | undefined, weight: number): number | null {
  const base = numberOrNull(value);
  if (base == null || base < 1 || base > 10) return null;
  return base * weight;
}

export function crossTrainingScores(cells: Record<string, CellValue>): { lines: Record<string, number | null>; sections: Record<string, number | null>; total: number | null } {
  const lines: Record<string, number | null> = {};
  const sections: Record<string, number | null> = { A: null, B: null, C: null, D: null };
  for (const item of CROSS_CRITERIA) {
    const score = scoreLine(cells[item.addr], item.weight);
    lines[item.addr] = score;
    if (score == null) continue;
    sections[item.section] = (sections[item.section] ?? 0) + score;
  }
  const parts = Object.values(sections).filter((value): value is number => value != null);
  return { lines, sections, total: parts.length ? parts.reduce((sum, value) => sum + value, 0) : null };
}

export function resultFill(value: string): "fill-green" | "fill-yellow" | "fill-red" | "" {
  if (value === "Pass") return "fill-green";
  if (value === "Minor NC") return "fill-yellow";
  if (value === "Major NC") return "fill-red";
  return "";
}

export function showCell(value: CellValue | null | undefined): string {
  if (value == null || value === false) return "";
  if (value === true) return "Yes";
  return String(value);
}
