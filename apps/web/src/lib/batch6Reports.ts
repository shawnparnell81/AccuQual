import { isChangeRequestForm } from "./changeRequestKinds";
import type { CellValue } from "./isoFormLogic";

export const BATCH6_KINDS = ["dev_electronic_csa", "dev_shock", "engineering_change", "drawing_change", "process_change", "document_change"] as const;
export type Batch6Kind = (typeof BATCH6_KINDS)[number];

export function isBatch6(kind: string): kind is Batch6Kind {
  return (BATCH6_KINDS as readonly string[]).includes(kind);
}

const SHAWN = "Shawn Parnell";
const MAXWELL = "Maxwell Tollefson";
const DIV0 = "#DIV/0!";
const VALUE = "#VALUE!";
const NUM = "#NUM!";

export const BATCH6_SHEET_TITLE: Record<Batch6Kind, string> = {
  dev_electronic_csa: "ELECTRONIC CSA DEVELOPMENT DOCUMENT",
  dev_shock: "SHOCK ABSORBER DEVELOPMENT DOCUMENT",
  engineering_change: "ENGINEERING CHANGE REQUEST (ECR)",
  drawing_change: "DRAWING CHANGE REQUEST",
  process_change: "PROCESS CHANGE REQUEST",
  document_change: "DOCUMENT CHANGE REQUEST",
};

export const BATCH6_PURPOSE: Record<Batch6Kind, string> = {
  dev_electronic_csa: "Purpose: To record baseline benchmarking data on used OE and competitor CSAs prior to factory prototype development.",
  dev_shock: "Purpose: To record baseline benchmarking data on OE and competitor Shocks prior to prototype development.",
  engineering_change: "",
  drawing_change: "",
  process_change: "",
  document_change: "",
};

export function blankBatch6(kind: Batch6Kind): Record<string, CellValue> {
  if (kind === "dev_electronic_csa") return { E2: MAXWELL, B10: SHAWN };
  if (kind === "dev_shock") return { E2: MAXWELL, B9: SHAWN };
  return { F2: MAXWELL, D5: SHAWN };
}

function arith(value: CellValue | undefined): number | string {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : VALUE;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.startsWith("#")) return value;
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : VALUE;
}

function div(numerator: number | string, denominator: number | string): number | string {
  if (typeof numerator === "string") return numerator;
  if (typeof denominator === "string") return denominator;
  if (denominator === 0) return DIV0;
  return numerator / denominator;
}

function sqrt(value: number | string): number | string {
  if (typeof value === "string") return value;
  if (value < 0) return NUM;
  return Math.sqrt(value);
}

function firstError(...values: Array<number | string>): string | null {
  const error = values.find((value) => typeof value === "string");
  return typeof error === "string" ? error : null;
}

/** Same spring block as CSA development: target force, natural frequency, Wahl stress, and stroke percents. */
export function evaluateElectronicCsa(cells: Record<string, CellValue>): Record<string, CellValue> {
  const weight = arith(cells.B8);
  const distribution = arith(cells.D8);
  const motion = arith(cells.B9);
  const loadError = firstError(weight, distribution, motion);
  const scaled = loadError ? loadError : div(((weight as number) * (distribution as number)) / 2, motion as number);
  const load = typeof scaled === "string" ? scaled : (scaled * 4.45) / 100;

  const rate = arith(cells.B33);
  let hertz: number | string;
  if (typeof load === "string") hertz = load;
  else if (typeof rate === "string") hertz = rate;
  else if (typeof motion === "string") hertz = motion;
  else {
    const wheelMass = div(load * motion, 9.81);
    const wheelRate = rate * motion * motion * 1000;
    const ratio = typeof wheelMass === "string" ? wheelMass : div(wheelRate, wheelMass);
    const root = typeof ratio === "string" ? ratio : sqrt(ratio);
    hertz = typeof root === "string" ? root : (1 / (2 * Math.PI)) * root;
  }

  const outside = arith(cells.B27);
  const wire = arith(cells.B24);
  let stress: number | string;
  if (typeof load === "string") stress = load;
  else if (typeof outside === "string") stress = outside;
  else if (typeof wire === "string") stress = wire;
  else {
    const mean = outside - wire;
    const forceMax = (load * 3.25) / 2;
    const index = div(mean, wire);
    if (typeof index === "string") stress = index;
    else if (4 * index - 4 === 0 || index === 0) stress = DIV0;
    else {
      const wahl = (4 * index - 1) / (4 * index - 4) + 0.615 / index;
      stress = div(8 * mean * forceMax * wahl, Math.PI * wire ** 3);
    }
  }

  const unloaded = arith(cells.B22);
  const ride = arith(cells.B34);
  const stroke = arith(cells.B38);
  const bump = arith(cells.B40);
  const displacedError = firstError(unloaded, ride, stroke);
  const displaced = displacedError ? displacedError : div((unloaded as number) - (ride as number), stroke as number);
  const bumpError = firstError(bump, stroke);
  const bumpPercent = bumpError ? bumpError : div(bump as number, stroke as number);
  return { B30: load, B31: hertz, B32: stress, B39: displaced, B41: bumpPercent };
}

export function evaluateBatch6(kind: Batch6Kind, cells: Record<string, CellValue>): Record<string, CellValue> {
  if (kind === "dev_electronic_csa") return evaluateElectronicCsa(cells);
  return {};
}

export function summaryBatch6(kind: Batch6Kind, cells: Record<string, CellValue>): string {
  if (isChangeRequestForm(kind)) {
    const part = cells.B6;
    const job = cells.B7;
    return [part, job].filter((value) => value !== undefined && value !== null && String(value).trim() !== "").map(String).join(" · ");
  }
  const part = cells.B6;
  const application = cells.D6;
  return [part, application].filter((value) => value !== undefined && value !== null && String(value).trim() !== "").map(String).join(" · ");
}

export function showBatch6(value: CellValue | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return VALUE;
    const rounded = Math.round(value * 1e6) / 1e6;
    return String(rounded);
  }
  return value;
}
