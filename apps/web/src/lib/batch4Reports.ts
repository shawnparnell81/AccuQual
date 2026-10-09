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
  // "50%", "1,000", and "12 mm" are typed values. The sheet formulas use the number.
  const body = text.replace(/,/g, "").replace(/%$/, "").trim();
  if (/^-?\d+(\.\d+)?$/.test(body)) return Number(body);
  const leading = body.match(/^(-?\d+(?:\.\d+)?)(?:\s+[A-Za-zµ°].*)?$/);
  if (leading?.[1]) return Number(leading[1]);
  return ERR_VALUE;
}

function present(value: Value): boolean {
  return value != null && value !== "";
}

function ready(values: Value[]): boolean {
  return values.every(present);
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

function excelAverage(values: Value[]): Num | "" {
  const numbers = values.filter((value) => present(value) && typeof value !== "boolean");
  if (numbers.length === 0) return "";
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
  const mass = read(cells, "B4");
  const temp = read(cells, "B5");
  const pressure = read(cells, "B6");
  const humidity = read(cells, "B7");
  const ms = read(cells, "B8");
  const im = read(cells, "B9");
  const rhoS = read(cells, "B10");
  const gamma = read(cells, "B11");
  const engine = waterEngine({ mass, temp, pressure, humidity, ms, im, rhoS, gamma, b13: read(cells, "B13") });
  if (ready([temp])) {
    put(computed, "B14", engine.es);
    put(computed, "B16", engine.water);
    put(computed, "B17", engine.satCorr);
  }
  if (ready([temp, pressure, humidity])) {
    put(computed, "B15", engine.air);
    put(computed, "B18", engine.saturated);
  }
  if (ready([ms, im])) put(computed, "B19", engine.balance);
  if (ready([temp, pressure, humidity, rhoS])) put(computed, "B20", engine.z);
  if (ready([mass, temp, pressure, humidity, ms, im])) put(computed, "B23", engine.actual);
  if (ready([mass, temp, pressure, humidity, ms, im, gamma])) put(computed, "B24", engine.v20);
  for (const line of [1, 2, 3]) {
    const empty = read(cells, `${line}B2`);
    const filled = read(cells, `${line}B3`);
    const lineTemp = read(cells, `${line}B6`);
    const linePressure = read(cells, `${line}B7`);
    const lineHumidity = read(cells, `${line}B8`);
    const lineMs = read(cells, `${line}B9`);
    const lineIm = read(cells, `${line}B10`);
    const nominal = read(cells, `${line}B4`);
    if (ready([empty, filled])) {
      put(computed, `${line}B5`, bin(num(filled), num(empty), (left, right) => left - right));
    }
    if (!ready([empty, filled, lineTemp, linePressure, lineHumidity, lineMs, lineIm])) continue;
    const fill = waterEngine({
      mass: bin(num(filled), num(empty), (left, right) => left - right),
      temp: lineTemp,
      pressure: linePressure,
      humidity: lineHumidity,
      ms: lineMs,
      im: lineIm,
      rhoS: 8,
      gamma: 0.00001,
      b13: 0,
    });
    put(computed, `${line}B12`, fill.actual);
    put(computed, `${line}B13`, fill.v20);
    put(computed, `${line}B14`, present(nominal) ? waterPass(fill.actual, nominal) : "");
  }
  return computed;
}

export function evaluateHeptane(cells: Record<string, CellValue>): Record<string, CellValue> {
  const computed: Record<string, CellValue> = {};
  const mass = read(cells, "B4");
  const temp = read(cells, "B5");
  const pressure = read(cells, "B6");
  const humidity = read(cells, "B7");
  const ms = read(cells, "B8");
  const im = read(cells, "B9");
  const rhoS = read(cells, "B10");
  const gamma = read(cells, "B11");
  const engine = heptaneEngine({ mass, temp, pressure, humidity, ms, im, rhoS, gamma, b13: null });
  if (ready([temp])) {
    put(computed, "B14", engine.es);
    put(computed, "B16", engine.density);
    put(computed, "B17", engine.satCorr);
  }
  if (ready([temp, pressure, humidity])) {
    put(computed, "B15", engine.air);
    put(computed, "B18", engine.saturated);
  }
  if (ready([ms, im])) put(computed, "B19", engine.balance);
  if (ready([temp, pressure, humidity, rhoS])) put(computed, "B20", engine.z);
  if (ready([mass, temp, pressure, humidity, ms, im, rhoS])) put(computed, "B23", engine.actual);
  if (ready([mass, temp, pressure, humidity, ms, im, rhoS, gamma])) put(computed, "B24", engine.v20);
  for (const line of [1, 2, 3]) {
    const first = read(cells, `${line}B3`);
    const second = read(cells, `${line}B2`);
    const lineTemp = read(cells, `${line}B6`);
    const linePressure = read(cells, `${line}B7`);
    const lineHumidity = read(cells, `${line}B8`);
    const lineMs = read(cells, `${line}B9`);
    const lineIm = read(cells, `${line}B10`);
    const nominal = read(cells, `${line}B4`);
    if (ready([first, second])) {
      put(computed, `${line}B5`, bin(num(first), num(second), (left, right) => left - right));
    }
    if (!ready([first, second, lineTemp, linePressure, lineHumidity, lineMs, lineIm])) continue;
    const fill = heptaneEngine({
      mass: bin(num(first), num(second), (left, right) => left - right),
      temp: lineTemp,
      pressure: linePressure,
      humidity: lineHumidity,
      ms: lineMs,
      im: lineIm,
      rhoS: 8,
      gamma: 0.00001,
      b13: null,
    });
    put(computed, `${line}B12`, fill.actual);
    put(computed, `${line}B13`, fill.v20);
    put(computed, `${line}B14`, present(nominal) ? heptanePass(fill.v20, nominal) : "");
  }
  return computed;
}

function targetNewtons(weight: Value, distribution: Value, ratio: Value, pounds: boolean): Num {
  const product = bin(num(weight), num(distribution), (left, right) => left * right);
  const half = div(product, 2);
  const scaled = div(half, num(ratio));
  return pounds ? div(bin(scaled, 4.45, (left, right) => left * right), 100) : div(scaled, 100);
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
  const wahlDenom = 4 * index - 4;
  if (index === 0 || wahlDenom === 0) return ERR_DIV;
  const wahl = (4 * index - 1) / wahlDenom + 0.615 / index;
  if (!Number.isFinite(wahl)) return ERR_DIV;
  const numer = bin(bin(bin(8, mean, (left, right) => left * right), forceMax, (left, right) => left * right), wahl, (left, right) => left * right);
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
  const weight = read(cells, "B8");
  const distribution = read(cells, "D8");
  const ratio = read(cells, "B9");
  const rate = read(cells, "B33");
  const outside = read(cells, "B27");
  const wire = read(cells, "B24");
  const unloaded = read(cells, "B22");
  const ride = read(cells, "B34");
  const stroke = read(cells, "B38");
  const bump = read(cells, "B40");
  const comp = read(cells, "F45");
  const reb = read(cells, "F46");
  const loadInputs = [weight, distribution, ratio];
  const load = ready(loadInputs) ? targetNewtons(weight, distribution, ratio, true) : "";
  if (load !== "") put(computed, "B30", load);
  if (ready([...loadInputs, rate])) put(computed, "B31", naturalFrequency(rate, load as Num, ratio));
  if (ready([...loadInputs, outside, wire])) put(computed, "B32", wahlStress(outside, wire, load as Num));
  if (ready([unloaded, ride, stroke])) put(computed, "B39", div(bin(num(unloaded), num(ride), (left, right) => left - right), num(stroke)));
  if (ready([bump, stroke])) put(computed, "B41", div(num(bump), num(stroke)));
  if (ready([...loadInputs, rate, comp, reb])) put(computed, "B47", percentDamped(comp, reb, ratio, rate, load as Num));
  return computed;
}

export function evaluateCoilDev(cells: Record<string, CellValue>): Record<string, CellValue> {
  const computed: Record<string, CellValue> = {};
  const weight = read(cells, "B8");
  const distribution = read(cells, "D8");
  const ratio = read(cells, "B9");
  const rate = read(cells, "B26");
  const outside = read(cells, "B20");
  const wire = read(cells, "B19");
  const loadInputs = [weight, distribution, ratio];
  const load = ready(loadInputs) ? targetNewtons(weight, distribution, ratio, true) : "";
  if (load !== "") put(computed, "B29", load);
  if (ready([...loadInputs, rate])) put(computed, "B30", naturalFrequency(rate, load as Num, ratio));
  if (ready([...loadInputs, outside, wire])) put(computed, "B31", wahlStress(outside, wire, load as Num));
  return computed;
}

export function evaluateFuelDev(cells: Record<string, CellValue>): Record<string, CellValue> {
  const computed: Record<string, CellValue> = {};
  const primary = read(cells, "B26");
  const secondary = read(cells, "B28");
  if (present(primary)) put(computed, "C26", bin(bin(num(primary), 6.29, (left, right) => left * right), 3.6, (left, right) => left * right));
  if (present(secondary)) put(computed, "C28", bin(bin(num(secondary), 6.29, (left, right) => left * right), 3.6, (left, right) => left * right));
  return computed;
}

export function evaluateGasDev(cells: Record<string, CellValue>): Record<string, CellValue> {
  const computed: Record<string, CellValue> = {};
  const fa = excelAverage([read(cells, "B31"), read(cells, "B34")]);
  const fb = excelAverage([read(cells, "B33"), read(cells, "B32")]);
  if (fa !== "") put(computed, "B35", fa);
  if (fb !== "") put(computed, "B36", fb);
  return computed;
}

export function evaluateAirSpringDev(cells: Record<string, CellValue>): Record<string, CellValue> {
  const computed: Record<string, CellValue> = {};
  const weight = read(cells, "B8");
  const distribution = read(cells, "D8");
  const ratio = read(cells, "B9");
  const at20 = read(cells, "B23");
  const at40 = read(cells, "B24");
  const rate20 = read(cells, "C23");
  const rate40 = read(cells, "C24");
  const loadInputs = [weight, distribution, ratio];
  if (!ready(loadInputs)) return computed;
  const load = targetNewtons(weight, distribution, ratio, false);
  put(computed, "B25", load);
  if (!ready([at20, at40])) return computed;
  const rise = div(bin(num(at40), num(at20), (left, right) => left - right), 20);
  const psi = bin(div(bin(load, num(at20), (left, right) => left - right), rise), 20, (left, right) => left + right);
  put(computed, "B26", psi);
  if (!ready([rate20, rate40])) return computed;
  const rateRise = div(bin(num(rate40), num(rate20), (left, right) => left - right), 20);
  put(computed, "B27", bin(bin(bin(num(psi), 20, (left, right) => left - right), rateRise, (left, right) => left * right), num(rate20), (left, right) => left + right));
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
