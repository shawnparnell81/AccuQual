/**
 * Salt spray, ASTM E542 water, ASTM E542 n-heptane, prototype evaluation,
 * development documents, and the FRM-CAR-001 supplier corrective action request.
 * Development documents are not the validation reports.
 * Concession / Deviation Request is already the live concession form and is not rebuilt here.
 */

import type { CellValue } from "./isoFormLogic";

const ERR_DIV = "#DIV/0!";
const ERR_VALUE = "#VALUE!";
const ERR_NUM = "#NUM!";
type Num = number | typeof ERR_DIV | typeof ERR_VALUE | typeof ERR_NUM;
type Value = CellValue | null;

export const BATCH4_KINDS = [
  "salt_spray",
  "volume_water",
  "volume_heptane",
  "prototype_strut",
  "dev_csa",
  "dev_fuel_pump",
  "dev_gas_lift",
  "dev_coil",
  "dev_air_spring",
  "scar_request",
] as const;
export type Batch4Kind = (typeof BATCH4_KINDS)[number];

export function isBatch4(kind: string): kind is Batch4Kind {
  return (BATCH4_KINDS as readonly string[]).includes(kind);
}

export const BATCH4_SHEET_TITLE: Record<Batch4Kind, string> = {
  salt_spray: "SALT SPRAY TEST REPORT (ASTM B117)",
  volume_water: "ASTM E542 Gravimetric Volume Calculator",
  volume_heptane: "ASTM E542 Gravimetric Volume Calculator",
  prototype_strut: "PROTOTYPE EVALUATION REPORT (STRUT ASSEMBLY)",
  dev_csa: "CSA DEVELOPMENT DOCUMENT",
  dev_fuel_pump: "FUEL PUMP DEVELOPMENT DOCUMENT",
  dev_gas_lift: "GAS LIFT SUPPORT DEVELOPMENT DOCUMENT",
  dev_coil: "COIL SPRING DEVELOPMENT DOCUMENT",
  dev_air_spring: "AIR SPRING DEVELOPMENT DOCUMENT",
  scar_request: "SUPPLIER CORRECTIVE ACTION REQUEST (SCAR)",
};

const SHAWN = "Shawn Parnell";
const MAXWELL = "Maxwell Tollefson";

function read(cells: Record<string, CellValue>, addr: string): Value {
  const value = cells[addr];
  if (value === undefined || value === "") return null;
  return value;
}

function num(value: Value): Num {
  if (value === null || value === undefined || value === "") return 0;
  if (value === ERR_DIV || value === ERR_VALUE || value === ERR_NUM) return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : ERR_VALUE;
  if (typeof value === "boolean") return value ? 1 : 0;
  const text = String(value).trim();
  if (text === ERR_DIV || text === ERR_VALUE || text === ERR_NUM) return text;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return ERR_VALUE;
}

function bin(left: Num, right: Num, op: (x: number, y: number) => number): Num {
  if (typeof left === "string") return left;
  if (typeof right === "string") return right;
  const result = op(left, right);
  return Number.isFinite(result) ? result : ERR_VALUE;
}

function div(left: Num, right: Num): Num {
  if (typeof left === "string") return left;
  if (typeof right === "string") return right;
  if (right === 0) return ERR_DIV;
  return left / right;
}

function fin(value: number): Num {
  return Number.isFinite(value) ? value : ERR_VALUE;
}

function sqrt(value: Num): Num {
  if (typeof value === "string") return value;
  if (value < 0) return ERR_NUM;
  return fin(Math.sqrt(value));
}

function excelAverage(values: Value[]): Num {
  const numbers = values.filter((value) => value !== null && value !== "" && typeof value !== "boolean");
  if (numbers.length === 0) return ERR_DIV;
  const parsed = numbers.map((value) => num(value));
  if (parsed.some((value) => typeof value === "string")) return ERR_VALUE;
  const list = parsed as number[];
  return list.reduce((sum, value) => sum + value, 0) / list.length;
}

export function showBatch4(value: CellValue | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return ERR_VALUE;
    const rounded = Math.round(value * 1e6) / 1e6;
    return String(rounded);
  }
  return value;
}

export function batch4Fill(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower === "fail" || lower.includes("fail")) return "#FF0000";
  if (lower === "pass" || lower.includes("pass")) return "#00B050";
  return null;
}

export function blankBatch4(kind: Batch4Kind): Record<string, CellValue> {
  if (kind === "salt_spray") {
    return { E2: MAXWELL, B41: SHAWN, B42: MAXWELL, B13: false, C13: false, B14: false, B39: false, D39: false, B40: false, C40: false, D40: false };
  }
  if (kind === "volume_water" || kind === "volume_heptane") return { B10: 8, B11: 0.00001 };
  if (kind === "prototype_strut") return { E2: MAXWELL, B58: SHAWN, B5: false, D5: false, B56: false, D56: false, E56: false };
  if (kind === "dev_csa") return { E2: MAXWELL, B10: SHAWN };
  if (kind === "dev_fuel_pump") return { D2: MAXWELL, B8: SHAWN };
  if (kind === "dev_gas_lift") return { B3: MAXWELL, B9: SHAWN };
  if (kind === "dev_coil") return { D2: MAXWELL, B10: SHAWN };
  if (kind === "dev_air_spring") return { D2: MAXWELL, B10: SHAWN };
  return { E2: MAXWELL, B7: SHAWN };
}

export function mergeBatch4(kind: Batch4Kind, data: unknown): Record<string, CellValue> {
  const base = blankBatch4(kind);
  if (!data || typeof data !== "object") return base;
  const cells = (data as { cells?: unknown }).cells;
  if (!cells || typeof cells !== "object") return base;
  for (const [key, value] of Object.entries(cells as Record<string, unknown>)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") base[key] = value;
    else if (value === null) base[key] = "";
  }
  return base;
}

interface VolumeInput {
  mass: Value;
  temp: Value;
  pressure: Value;
  humidity: Value;
  ms: Value;
  im: Value;
  rhoS: Value;
  gamma: Value;
  b13: Value;
}

function waterEngine(input: VolumeInput) {
  const temp = num(input.temp);
  const pressure = num(input.pressure);
  const humidity = num(input.humidity);
  const extra = num(input.b13);
  const es = bin(1.3146e9, bin(-5315.56, bin(273.15, temp, (left, right) => left + right), (left, right) => left / right), (left, right) => left * Math.exp(right));
  const airInner = bin(pressure, bin(0.003796, bin(humidity, extra, (left, right) => left * right), (left, right) => left * right), (left, right) => left - right);
  const air = div(div(bin(0.4646, airInner, (left, right) => left * right), bin(273.15, temp, (left, right) => left + right)), 1000);
  const tShift = bin(temp, 3.983035, (left, right) => left - right);
  const numer = bin(bin(tShift, tShift, (left, right) => left * right), bin(temp, 301.797, (left, right) => left + right), (left, right) => left * right);
  const denom = bin(522528.9, bin(temp, 69.34881, (left, right) => left + right), (left, right) => left * right);
  const ratio = div(numer, denom);
  const water = bin(999.97495, bin(1, ratio, (left, right) => left - right), (left, right) => (left * right) / 1000);
  const satCorr = bin(bin(-4.612, bin(0.106, temp, (left, right) => left * right), (left, right) => left + right), 1_000_000, (left, right) => left / right);
  const saturated = bin(air, water, (left, right) => left + right);
  const balance = div(num(input.ms), num(input.im));
  const z = bin(bin(1, div(es, num(input.rhoS)), (left, right) => left - right), div(1, bin(satCorr, es, (left, right) => left - right)), (left, right) => left * right);
  const actual = bin(bin(num(input.mass), saturated, (left, right) => left * right), balance, (left, right) => left * right);
  const v20 = bin(actual, bin(1, bin(num(input.gamma), bin(temp, 20, (left, right) => left - right), (left, right) => left * right), (left, right) => left - right), (left, right) => left * right);
  return { es, air, water, satCorr, saturated, balance, z, actual, v20 };
}

function heptaneEngine(input: VolumeInput) {
  const temp = num(input.temp);
  const exponent = bin(8.07131, div(1730.63, bin(233.426, temp, (left, right) => left + right)), (left, right) => left - right);
  const es = typeof exponent === "string" ? exponent : fin(10 ** exponent);
  const airInner = bin(num(input.pressure), bin(div(num(input.humidity), 100), es, (left, right) => left * right), (left, right) => left - right);
  const air = div(div(bin(0.4646, airInner, (left, right) => left * right), bin(273.15, temp, (left, right) => left + right)), 1000);
  const density = bin(0.70072, bin(0.000848, temp, (left, right) => left * right), (left, right) => left - right);
  const satCorr: Num = 0;
  const saturated = bin(density, satCorr, (left, right) => left + right);
  const balance = div(num(input.ms), num(input.im));
  const z = bin(bin(1, div(air, num(input.rhoS)), (left, right) => left - right), div(1, bin(saturated, air, (left, right) => left - right)), (left, right) => left * right);
  const actual = bin(bin(num(input.mass), balance, (left, right) => left * right), z, (left, right) => left * right);
  const v20 = bin(actual, bin(1, bin(num(input.gamma), bin(temp, 20, (left, right) => left - right), (left, right) => left * right), (left, right) => left - right), (left, right) => left * right);
  return { es, air, density, satCorr, saturated, balance, z, actual, v20 };
}

function waterPass(actual: Num, line: Value): Num | string {
  const target = num(line);
  const pct = bin(div(bin(actual, target, (left, right) => left - right), actual), 100, (left, right) => left * right);
  if (typeof pct === "string") return pct;
  return pct < 5 && pct > -5 ? "PASS" : "FAIL";
}

function heptanePass(v20: Num, line: Value): Num | string {
  const target = num(line);
  const pct = bin(div(bin(v20, target, (left, right) => left - right), target), 100, (left, right) => Math.abs(left) * right);
  if (typeof pct === "string") return pct;
  return pct <= 5 ? "PASS" : "FAIL";
}

function put(computed: Record<string, CellValue>, addr: string, value: Num | string) {
  computed[addr] = value;
}

export function evaluateWater(cells: Record<string, CellValue>): Record<string, CellValue> {
  const computed: Record<string, CellValue> = {};
  const engine = waterEngine({
    mass: read(cells, "B4"),
    temp: read(cells, "B5"),
    pressure: read(cells, "B6"),
    humidity: read(cells, "B7"),
    ms: read(cells, "B8"),
    im: read(cells, "B9"),
    rhoS: read(cells, "B10"),
    gamma: read(cells, "B11"),
    b13: read(cells, "B13"),
  });
  put(computed, "B14", engine.es);
  put(computed, "B15", engine.air);
  put(computed, "B16", engine.water);
  put(computed, "B17", engine.satCorr);
  put(computed, "B18", engine.saturated);
  put(computed, "B19", engine.balance);
  put(computed, "B20", engine.z);
  put(computed, "B23", engine.actual);
  put(computed, "B24", engine.v20);
  for (const line of [1, 2, 3]) {
    const mass = bin(num(read(cells, `${line}B3`)), num(read(cells, `${line}B2`)), (left, right) => left - right);
    put(computed, `${line}B5`, mass);
    const fill = waterEngine({
      mass,
      temp: read(cells, `${line}B6`),
      pressure: read(cells, `${line}B7`),
      humidity: read(cells, `${line}B8`),
      ms: read(cells, `${line}B9`),
      im: read(cells, `${line}B10`),
      rhoS: 8,
      gamma: 0.00001,
      b13: 0,
    });
    put(computed, `${line}B12`, fill.actual);
    put(computed, `${line}B13`, fill.v20);
    put(computed, `${line}B14`, waterPass(fill.actual, read(cells, `${line}B4`)));
  }
  return computed;
}

export function evaluateHeptane(cells: Record<string, CellValue>): Record<string, CellValue> {
  const computed: Record<string, CellValue> = {};
  const engine = heptaneEngine({
    mass: read(cells, "B4"),
    temp: read(cells, "B5"),
    pressure: read(cells, "B6"),
    humidity: read(cells, "B7"),
    ms: read(cells, "B8"),
    im: read(cells, "B9"),
    rhoS: read(cells, "B10"),
    gamma: read(cells, "B11"),
    b13: null,
  });
  put(computed, "B14", engine.es);
  put(computed, "B15", engine.air);
  put(computed, "B16", engine.density);
  put(computed, "B17", engine.satCorr);
  put(computed, "B18", engine.saturated);
  put(computed, "B19", engine.balance);
  put(computed, "B20", engine.z);
  put(computed, "B23", engine.actual);
  put(computed, "B24", engine.v20);
  for (const line of [1, 2, 3]) {
    const mass = bin(num(read(cells, `${line}B3`)), num(read(cells, `${line}B2`)), (left, right) => left - right);
    put(computed, `${line}B5`, mass);
    const fill = heptaneEngine({
      mass,
      temp: read(cells, `${line}B6`),
      pressure: read(cells, `${line}B7`),
      humidity: read(cells, `${line}B8`),
      ms: read(cells, `${line}B9`),
      im: read(cells, `${line}B10`),
      rhoS: 8,
      gamma: 0.00001,
      b13: null,
    });
    put(computed, `${line}B12`, fill.actual);
    put(computed, `${line}B13`, fill.v20);
    put(computed, `${line}B14`, heptanePass(fill.v20, read(cells, `${line}B4`)));
  }
  return computed;
}

function targetNewtons(weight: Value, distribution: Value, ratio: Value, pounds: boolean): Num {
  const scaled = bin(bin(bin(num(weight), num(distribution), (left, right) => left * right), 2, (left, right) => left / right), num(ratio), (left, right) => left / right);
  return pounds ? bin(bin(scaled, 4.45, (left, right) => left * right), 100, (left, right) => left / right) : div(scaled, 100);
}

function naturalFrequency(rate: Value, load: Num, ratio: Value): Num {
  const mr = num(ratio);
  const wheelMass = div(bin(load, mr, (left, right) => left * right), 9.81);
  const wheelRate = bin(bin(num(rate), bin(mr, mr, (left, right) => left * right), (left, right) => left * right), 1000, (left, right) => left * right);
  return bin(div(1, bin(2, Math.PI, (left, right) => left * right)), sqrt(div(wheelRate, wheelMass)), (left, right) => left * right);
}

function wahlStress(outside: Value, wire: Value, load: Num): Num {
  const mean = bin(num(outside), num(wire), (left, right) => left - right);
  const forceMax = bin(load, 3.25 / 2, (left, right) => left * right);
  const index = div(mean, num(wire));
  if (typeof index === "string") return index;
  const wahl = (4 * index - 1) / (4 * index - 4) + 0.615 / index;
  const numer = bin(bin(bin(8, mean, (left, right) => left * right), forceMax, (left, right) => left * right), Number.isFinite(wahl) ? wahl : ERR_VALUE, (left, right) => left * right);
  const denom = bin(Math.PI, bin(num(wire), 3, (left, right) => left ** right), (left, right) => left * right);
  return div(numer, denom);
}

function percentDamped(comp: Value, reb: Value, ratio: Value, rate: Value, load: Num): Num {
  const split = div(num(reb), num(comp));
  const mr = num(ratio);
  const wheelMass = div(bin(load, mr, (left, right) => left * right), 9.81);
  const wheelRate = bin(bin(num(rate), bin(mr, mr, (left, right) => left * right), (left, right) => left * right), 1000, (left, right) => left * right);
  const cc = bin(2, sqrt(bin(wheelRate, wheelMass, (left, right) => left * right)), (left, right) => left * right);
  const factor = bin(bin(5, sqrt(bin(2, bin(bin(split, split, (left, right) => left * right), 1, (left, right) => left + right), (left, right) => left * right)), (left, right) => left * right), mr, (left, right) => left * right);
  const ratioForce = div(bin(num(comp), factor, (left, right) => left * right), cc);
  return bin(ratioForce, ratioForce, (left, right) => left * right);
}

export function evaluateCsaDev(cells: Record<string, CellValue>): Record<string, CellValue> {
  const computed: Record<string, CellValue> = {};
  const load = targetNewtons(read(cells, "B8"), read(cells, "D8"), read(cells, "B9"), true);
  put(computed, "B30", load);
  put(computed, "B31", naturalFrequency(read(cells, "B33"), load, read(cells, "B9")));
  put(computed, "B32", wahlStress(read(cells, "B27"), read(cells, "B24"), load));
  put(computed, "B39", div(bin(num(read(cells, "B22")), num(read(cells, "B34")), (left, right) => left - right), num(read(cells, "B38"))));
  put(computed, "B41", div(num(read(cells, "B40")), num(read(cells, "B38"))));
  put(computed, "B47", percentDamped(read(cells, "F45"), read(cells, "F46"), read(cells, "B9"), read(cells, "B33"), load));
  return computed;
}

export function evaluateCoilDev(cells: Record<string, CellValue>): Record<string, CellValue> {
  const computed: Record<string, CellValue> = {};
  const load = targetNewtons(read(cells, "B8"), read(cells, "D8"), read(cells, "B9"), true);
  put(computed, "B29", load);
  put(computed, "B30", naturalFrequency(read(cells, "B26"), load, read(cells, "B9")));
  put(computed, "B31", wahlStress(read(cells, "B20"), read(cells, "B19"), load));
  return computed;
}

export function evaluateFuelDev(cells: Record<string, CellValue>): Record<string, CellValue> {
  return {
    C26: bin(bin(num(read(cells, "B26")), 6.29, (left, right) => left * right), 3.6, (left, right) => left * right),
    C28: bin(bin(num(read(cells, "B28")), 6.29, (left, right) => left * right), 3.6, (left, right) => left * right),
  };
}

export function evaluateGasDev(cells: Record<string, CellValue>): Record<string, CellValue> {
  return {
    B35: excelAverage([read(cells, "B31"), read(cells, "B34")]),
    B36: excelAverage([read(cells, "B33"), read(cells, "B32")]),
  };
}

export function evaluateAirSpringDev(cells: Record<string, CellValue>): Record<string, CellValue> {
  const computed: Record<string, CellValue> = {};
  const load = targetNewtons(read(cells, "B8"), read(cells, "D8"), read(cells, "B9"), false);
  put(computed, "B25", load);
  const rise = div(bin(num(read(cells, "B24")), num(read(cells, "B23")), (left, right) => left - right), 20);
  put(computed, "B26", bin(div(bin(load, num(read(cells, "B23")), (left, right) => left - right), rise), 20, (left, right) => left + right));
  const rateRise = div(bin(num(read(cells, "C24")), num(read(cells, "C23")), (left, right) => left - right), 20);
  const psi = computed.B26;
  put(computed, "B27", bin(bin(bin(num(psi ?? null), 20, (left, right) => left - right), rateRise, (left, right) => left * right), num(read(cells, "C23")), (left, right) => left + right));
  return computed;
}

export function evaluateBatch4(kind: Batch4Kind, cells: Record<string, CellValue>): Record<string, CellValue> {
  if (kind === "volume_water") return evaluateWater(cells);
  if (kind === "volume_heptane") return evaluateHeptane(cells);
  if (kind === "dev_csa") return evaluateCsaDev(cells);
  if (kind === "dev_coil") return evaluateCoilDev(cells);
  if (kind === "dev_fuel_pump") return evaluateFuelDev(cells);
  if (kind === "dev_gas_lift") return evaluateGasDev(cells);
  if (kind === "dev_air_spring") return evaluateAirSpringDev(cells);
  return {};
}

export function summaryBatch4(kind: Batch4Kind, cells: Record<string, CellValue>): string {
  const pick = (addr: string) => {
    const value = cells[addr];
    return typeof value === "string" && value.trim() ? value.trim() : "";
  };
  if (kind === "salt_spray") return pick("B6") || pick("B5");
  if (kind === "prototype_strut") return pick("B8") || pick("D8");
  if (kind === "dev_csa") return pick("B6");
  if (kind === "dev_fuel_pump") return pick("B6");
  if (kind === "dev_gas_lift") return pick("B7");
  if (kind === "dev_coil" || kind === "dev_air_spring") return pick("B6");
  if (kind === "scar_request") return pick("B5") || pick("B8");
  if (kind === "volume_water") return "Water";
  if (kind === "volume_heptane") return "n-Heptane";
  return "";
}
