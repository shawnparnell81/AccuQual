import type { CellValue } from "./isoFormLogic";

export const BATCH5_KINDS = [
  "dev_air_compressor",
  "dev_fuel_injector",
  "dev_electric_lift",
  "dev_air_strut",
  "dev_brake_wear",
  "dev_electronic_shock",
] as const;
export type Batch5Kind = (typeof BATCH5_KINDS)[number];

export function isBatch5(kind: string): kind is Batch5Kind {
  return (BATCH5_KINDS as readonly string[]).includes(kind);
}

const SHAWN = "Shawn Parnell";
const MAXWELL = "Maxwell Tollefson";
const DIV0 = "#DIV/0!";
const VALUE = "#VALUE!";

export const BATCH5_SHEET_TITLE: Record<Batch5Kind, string> = {
  dev_air_compressor: "AIR COMPRESSOR DEVELOPMENT DOCUMENT",
  dev_fuel_injector: "FUEL INJECTOR DEVELOPMENT DOCUMENT",
  dev_electric_lift: "ELECTRIC LIFT SUPPORT DEVELOPMENT DOCUMENT",
  dev_air_strut: "AIR STRUT DEVELOPMENT DOCUMENT",
  dev_brake_wear: "BRAKE WEAR SENSOR DEVELOPMENT DOCUMENT",
  dev_electronic_shock: "ELECTRONIC SHOCK ABSORBER DEVELOPMENT DOCUMENT",
};

export const BATCH5_PURPOSE: Record<Batch5Kind, string> = {
  dev_air_compressor: "Purpose: To record baseline benchmarking data on OE and competitor Air Suspension Compressors prior to prototype development.",
  dev_fuel_injector: "Purpose: To record baseline benchmarking data on OE and competitor Fuel Injectors prior to prototype development.",
  dev_electric_lift: "Purpose: To record baseline benchmarking data on OE and competitor Electric Lift Supports (Power Tailgates) prior to prototype development.",
  dev_air_strut: "Purpose: To record baseline benchmarking data on OE and competitor Air Struts prior to prototype development.",
  dev_brake_wear: "Purpose: To record baseline data on OE and competitor Brake Wear Sensors prior to prototype development.",
  dev_electronic_shock: "Purpose: To record baseline benchmarking data on OE and competitor Electronic Shocks (non-air) prior to prototype development.",
};

export const BATCH5_EFFECTIVE: Record<Batch5Kind, string> = {
  dev_air_compressor: "03/04/2026",
  dev_fuel_injector: "03/04/2026",
  dev_electric_lift: "03/09/2026",
  dev_air_strut: "03/25/2026",
  dev_brake_wear: "7/14/2026",
  dev_electronic_shock: "03/03/2026",
};

export const BATCH5_REV: Record<Batch5Kind, string> = {
  dev_air_compressor: "A",
  dev_fuel_injector: "A",
  dev_electric_lift: "B",
  dev_air_strut: "B",
  dev_brake_wear: "B",
  dev_electronic_shock: "A",
};

/** Pulse widths (ms) used by the fuel-injector TREND / SLOPE block. */
export const INJECTOR_PULSE_MS = [3, 4, 5, 6, 7] as const;

export function blankBatch5(kind: Batch5Kind): Record<string, CellValue> {
  if (kind === "dev_air_compressor") return { D2: MAXWELL, B8: SHAWN, B26: "12.0 VDC" };
  if (kind === "dev_fuel_injector") return { D2: MAXWELL, B8: SHAWN, B28: "14.0 VDC" };
  if (kind === "dev_electric_lift") return { D2: MAXWELL, B8: SHAWN, B27: "12.0 VDC", B34: "5.0 VDC", B36: "5.0 VDC" };
  if (kind === "dev_air_strut") return { F2: MAXWELL, B9: SHAWN };
  if (kind === "dev_brake_wear") return { B8: SHAWN };
  return { E2: MAXWELL, B9: SHAWN };
}

function present(value: CellValue | undefined): boolean {
  return !(value === undefined || value === null || (typeof value === "string" && value.trim() === ""));
}

function arith(value: CellValue | undefined): number | string {
  if (!present(value)) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : VALUE;
  if (typeof value === "boolean") return value ? 1 : 0;
  const text = String(value).trim();
  if (text.startsWith("#")) return text;
  const body = text.replace(/,/g, "").replace(/%$/, "").trim();
  if (/^-?\d+(\.\d+)?$/.test(body)) return Number(body);
  const leading = body.match(/^(-?\d+(?:\.\d+)?)(?:\s+[A-Za-zµ°].*)?$/);
  if (leading?.[1]) return Number(leading[1]);
  return VALUE;
}

function div(numerator: number | string, denominator: number | string): number | string {
  if (typeof numerator === "string") return numerator;
  if (typeof denominator === "string") return denominator;
  if (denominator === 0) return DIV0;
  return numerator / denominator;
}

function average(values: Array<CellValue | undefined>): number | string {
  const nums: number[] = [];
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const parsed = arith(value);
    if (typeof parsed === "string") return parsed;
    nums.push(parsed);
  }
  if (nums.length === 0) return DIV0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function regression(xs: number[], ys: number[]): { slope: number; intercept: number } | string {
  if (xs.length !== ys.length || xs.length < 2) return VALUE;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let nume = 0;
  let den = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const x = xs[index];
    const y = ys[index];
    if (x === undefined || y === undefined) return VALUE;
    const dx = x - meanX;
    nume += dx * (y - meanY);
    den += dx * dx;
  }
  if (den === 0) return DIV0;
  const slope = nume / den;
  return { slope, intercept: meanY - slope * meanX };
}

/** SAE J1832 dynamic-flow block: converted volume, TREND, SLOPE, and estimated static flow. */
export function evaluateFuelInjectorDev(cells: Record<string, CellValue>): Record<string, CellValue> {
  const computed: Record<string, CellValue> = {};
  const divisors = [6000, 6000, 3000, 3000, 3000];
  const rows = [30, 31, 32, 33, 34];
  const converted: Array<number | string> = [];
  const allFlows = rows.every((row) => present(cells[`B${row}`]));
  for (let index = 0; index < 5; index += 1) {
    const row = rows[index] ?? 30;
    if (!present(cells[`B${row}`])) continue;
    const raw = arith(cells[`B${row}`]);
    const divisor = divisors[index] ?? 1;
    const value = typeof raw === "string" ? raw : raw / divisor;
    computed[`C${row}`] = value;
    converted.push(value);
  }
  if (!allFlows) {
    if (present(cells.B36)) {
      const staticRaw = arith(cells.B36);
      computed.B37 = typeof staticRaw === "string" ? staticRaw : staticRaw * 2;
    }
    return computed;
  }
  const knownY: number[] = [];
  let trendError: string | null = null;
  for (const value of converted) {
    if (typeof value === "string") trendError = trendError ?? value;
    else knownY.push(value);
  }
  const fit = trendError ? trendError : regression([...INJECTOR_PULSE_MS], knownY);
  for (let index = 0; index < 5; index += 1) {
    const row = 30 + index;
    const pulse = INJECTOR_PULSE_MS[index];
    if (typeof fit === "string") computed[`D${row}`] = fit;
    else if (pulse === undefined) computed[`D${row}`] = VALUE;
    else computed[`D${row}`] = fit.intercept + fit.slope * pulse;
  }
  if (present(cells.B36)) {
    const staticRaw = arith(cells.B36);
    computed.B37 = typeof staticRaw === "string" ? staticRaw : staticRaw * 2;
  }
  const c30 = computed.C30;
  const d30 = computed.D30;
  if (typeof c30 !== "number") computed.B38 = typeof c30 === "string" ? c30 : VALUE;
  else if (typeof d30 !== "number") computed.B38 = typeof d30 === "string" ? d30 : VALUE;
  else if (c30 === 0) computed.B38 = DIV0;
  else computed.B38 = Math.abs((c30 - d30) / c30);
  if (typeof fit === "string") {
    computed.B39 = fit;
    computed.B40 = fit;
  } else {
    computed.B39 = fit.slope;
    computed.B40 = fit.slope * 1000 * 60;
  }
  return computed;
}

/** 0–100 PSI fill-time average and dynamic CFM from the 0.5-gal tank formula. */
export function evaluateAirCompressorDev(cells: Record<string, CellValue>): Record<string, CellValue> {
  const times = [cells.B27, cells.B28, cells.B29];
  if (!times.some(present)) return {};
  const averageTime = average(times);
  const flow = div((100 / 14.7) * (0.5 / 7.48), averageTime);
  return {
    B30: averageTime,
    B31: typeof flow === "string" ? flow : flow * 60,
  };
}

/** Spring rate from F4, F3, and stroke: (F4 − F3) / (stroke − 20). */
export function evaluateElectricLiftDev(cells: Record<string, CellValue>): Record<string, CellValue> {
  if (!present(cells.B42) || !present(cells.B41) || !present(cells.B14)) return {};
  const f4 = arith(cells.B42);
  const f3 = arith(cells.B41);
  const stroke = arith(cells.B14);
  if (typeof f4 === "string") return { B44: f4 };
  if (typeof f3 === "string") return { B44: f3 };
  if (typeof stroke === "string") return { B44: stroke };
  return { B44: div(f4 - f3, stroke - 20) };
}

/**
 * Ride-height force, PSI, and spring rate.
 * B26 = vehicle weight × weight distribution / 2 / motion ratio × 4.45 / 100.
 */
export function evaluateAirStrutDev(cells: Record<string, CellValue>): Record<string, CellValue> {
  if (!present(cells.B8) || !present(cells.D8) || !present(cells.F8)) return {};
  const weight = arith(cells.B8);
  const distribution = arith(cells.D8);
  const motion = arith(cells.F8);
  if (typeof weight === "string") return { B26: weight, B27: weight, B28: weight };
  if (typeof distribution === "string") return { B26: distribution, B27: distribution, B28: distribution };
  if (typeof motion === "string") return { B26: motion, B27: motion, B28: motion };
  const target = div((weight * distribution) / 2, motion);
  if (typeof target === "string") return { B26: target, B27: target, B28: target };
  const force = (target * 4.45) / 100;
  if (!present(cells.B24) || !present(cells.B25) || !present(cells.C24) || !present(cells.C25)) return { B26: force };
  const at20 = arith(cells.B24);
  const at40 = arith(cells.B25);
  const rate20 = arith(cells.C24);
  const rate40 = arith(cells.C25);
  if (typeof at20 === "string" || typeof at40 === "string" || typeof rate20 === "string" || typeof rate40 === "string") {
    const error = [at20, at40, rate20, rate40].find((value) => typeof value === "string") as string;
    return { B26: force, B27: error, B28: error };
  }
  const psi = div(force - at20, (at40 - at20) / 20);
  if (typeof psi === "string") return { B26: force, B27: psi, B28: psi };
  const ridePsi = psi + 20;
  const rate = ((ridePsi - 20) * ((rate40 - rate20) / 20)) + rate20;
  return { B26: force, B27: ridePsi, B28: rate };
}

export function evaluateBatch5(kind: Batch5Kind, cells: Record<string, CellValue>): Record<string, CellValue> {
  if (kind === "dev_air_compressor") return evaluateAirCompressorDev(cells);
  if (kind === "dev_fuel_injector") return evaluateFuelInjectorDev(cells);
  if (kind === "dev_electric_lift") return evaluateElectricLiftDev(cells);
  if (kind === "dev_air_strut") return evaluateAirStrutDev(cells);
  return {};
}

export function summaryBatch5(kind: Batch5Kind, cells: Record<string, CellValue>): string {
  const part = cells.B6;
  const application = cells.C6;
  const text = [part, application].filter((value) => value !== undefined && value !== null && String(value).trim() !== "").map(String);
  return text.join(" · ");
}

export function showBatch5(value: CellValue | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return VALUE;
    const rounded = Math.round(value * 1e6) / 1e6;
    return String(rounded);
  }
  return value;
}

/** Linear deviation at 3 ms must stay under 5% (SAE note on the injector workbook). */
export function injectorDeviationFill(value: CellValue | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value < 0.05 ? "#00B050" : "#FF0000";
}
