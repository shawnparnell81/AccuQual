import { DIMENSIONS as STRUT_DIMENSIONS, DAMPING_STATES, ELECTRONICS as STRUT_ELECTRONICS, evaluate as strutEvaluate, PNEUMATIC as STRUT_PNEUMATIC, VELOCITY_COLS, WEIGHTS as STRUT_WEIGHTS } from "./airStrutReport";
import { DIMENSIONS as SPRING_DIMENSIONS, ELECTRONICS as SPRING_ELECTRONICS, evaluate as springEvaluate, PNEUMATIC as SPRING_PNEUMATIC, WEIGHTS as SPRING_WEIGHTS } from "./airSpringReport";
import { blankBatch, evaluateBatch, type Batch3Kind } from "./batch3Reports";
import { PARAMETER_NAMES } from "./fuelPumpReport";
import { headerStatusFor } from "./headerStatus";
import { blankBrakeCells, blankInjectorCells, evaluateBrake, evaluateInjector } from "./partInspection";
import type { CellValue } from "./validationReport";
import { evaluate as csaEvaluate, FORMULA_TEXT as csaFormulas } from "./validationReport";
import { evaluate as fuelEvaluate, FORMULA_TEXT as fuelFormulas } from "./fuelPumpReport";

export interface FailedMeasurement {
  addr: string;
  measurement: string;
  spec: string;
  actual: string;
}

const CSA_CRITERIA: Record<number, string> = {
  12: "Hardwear Grade",
  13: "Max Length (Extended) (mm)",
  14: "Min Length (Compressed) (mm)",
  15: "Stroke (mm)",
  16: "Displacement at Ride Height Force (mm)",
  17: "Percent Stroke Used (%)",
  18: "Strut Paint Thickness (µm)",
  22: "Piston Rod Diameter (mm)",
  23: "Compression Force @ 1.0m/s (N)",
  24: "Compression Force @ 0.6m/s (N)",
  25: "Compression Force @ 0.3m/s (N)",
  26: "Compression Force @ 0.1m/s (N)",
  27: "Compression Force @ 0.05m/s (N)",
  28: "Rebound Force @ 0.05m/s (N)",
  29: "Rebound Force @ 0.1m/s (N)",
  30: "Rebound Force @ 0.3m/s (N)",
  31: "Rebound Force @ 0.6m/s (N)",
  32: "Rebound Force @ 1.0m/s (N)",
  36: "Max Length (Free Height) (mm)",
  37: "Outer Diameter (mm)",
  38: "Coil Count (Total)",
  39: "Wire Thickness (mm)",
  40: "Spring Rate (N/mm)",
  41: "Spring Paint Thickness (µm)",
  45: "Mount Paint Thickness (µm)",
  46: "Bump Stop Length (mm)",
};

function show(value: CellValue | undefined): string {
  if (value == null || value === "") return "(blank)";
  return String(value);
}

function rowOf(addr: string): number {
  const match = addr.match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function csaRows(cells: Record<string, CellValue>): FailedMeasurement[] {
  const graded = csaEvaluate(cells);
  const rows: FailedMeasurement[] = [];
  for (const [addr, formula] of Object.entries(csaFormulas)) {
    if (addr === "A1" || !/pass|fail/i.test(formula)) continue;
    if (!/^fail/i.test(String(graded[addr] ?? ""))) continue;
    const row = rowOf(addr);
    const sample = addr.startsWith("G") ? "E" : "D";
    rows.push({
      addr,
      measurement: CSA_CRITERIA[row] ?? `Row ${row}`,
      spec: `${show(cells[`B${row}`])} ± ${show(cells[`C${row}`])}`,
      actual: show(cells[`${sample}${row}`]),
    });
  }
  return rows;
}

function fuelRows(cells: Record<string, CellValue>): FailedMeasurement[] {
  const graded = fuelEvaluate(cells);
  const rows: FailedMeasurement[] = [];
  for (const [addr, formula] of Object.entries(fuelFormulas)) {
    if (addr === "J2" || addr === "B51" || !/pass|fail/i.test(formula)) continue;
    if (!/^fail/i.test(String(graded[addr] ?? ""))) continue;
    const row = rowOf(addr);
    const name = row >= 13 && row <= 23 ? (PARAMETER_NAMES[row - 13] ?? "").trim() : `Row ${row}`;
    rows.push({
      addr,
      measurement: name || `Row ${row}`,
      spec: `${show(cells[`B${row}`])} ± ${show(cells[`D${row}`])}`,
      actual: show(cells[`G${row}`]),
    });
  }
  return rows;
}

function filled(cells: Record<string, CellValue>, addr: string): boolean {
  const value = cells[addr];
  return value != null && value !== "";
}

function airLabelRows(kind: "air_strut" | "air_spring", cells: Record<string, CellValue>): FailedMeasurement[] {
  const graded = kind === "air_strut" ? strutEvaluate(cells) : springEvaluate(cells);
  const dimensions = kind === "air_strut" ? STRUT_DIMENSIONS : SPRING_DIMENSIONS;
  const pneumatic = kind === "air_strut" ? STRUT_PNEUMATIC : SPRING_PNEUMATIC;
  const electronics = kind === "air_strut" ? STRUT_ELECTRONICS : SPRING_ELECTRONICS;
  const weights = kind === "air_strut" ? STRUT_WEIGHTS : SPRING_WEIGHTS;
  const rows: FailedMeasurement[] = [];
  for (const item of [...dimensions, ...pneumatic]) {
    const addr = `H${item.row}`;
    if (graded[addr] !== "Fail") continue;
    if (!filled(cells, `B${item.row}`) || !filled(cells, `D${item.row}`) || !filled(cells, `F${item.row}`)) continue;
    rows.push({
      addr,
      measurement: item.label.replace(/:$/, ""),
      spec: `${show(cells[`B${item.row}`])} ± ${show(cells[`D${item.row}`])}`,
      actual: show(cells[`F${item.row}`]),
    });
  }
  if (kind === "air_strut") {
    for (const state of DAMPING_STATES) {
      for (const col of VELOCITY_COLS) {
        for (const [passRow, sampleRow, nominalRow, tolRow, side] of [
          [state.passComp, state.sampleComp, state.nominalComp, state.tolComp, "compression"],
          [state.passReb, state.sampleReb, state.nominalReb, state.tolReb, "rebound"],
        ] as const) {
          const addr = `${col}${passRow}`;
          if (graded[addr] !== "Fail") continue;
          if (!filled(cells, `${col}${sampleRow}`) || !filled(cells, `${col}${nominalRow}`) || !filled(cells, `${col}${tolRow}`)) continue;
          rows.push({
            addr,
            measurement: `${state.label} ${side}`,
            spec: `${show(cells[`${col}${nominalRow}`])} ± ${show(cells[`${col}${tolRow}`])}`,
            actual: show(cells[`${col}${sampleRow}`]),
          });
        }
      }
    }
  }
  for (const item of electronics) {
    const addr = `H${item.row}`;
    if (graded[addr] !== "Fail") continue;
    if (!filled(cells, `B${item.row}`) || !filled(cells, `E${item.row}`)) continue;
    rows.push({ addr, measurement: item.label.replace(/:$/, ""), spec: show(cells[`B${item.row}`]), actual: show(cells[`E${item.row}`]) });
  }
  for (const item of weights) {
    const addr = `F${item.row}`;
    if (graded[addr] !== "Fail") continue;
    if (!filled(cells, `B${item.row}`) || !filled(cells, `D${item.row}`)) continue;
    rows.push({ addr, measurement: item.label.replace(/:$/, ""), spec: show(cells[`B${item.row}`]), actual: show(cells[`D${item.row}`]) });
  }
  return rows;
}

const BATCH: Record<string, Batch3Kind> = {
  shock: "shock",
  air_compressor: "air_compressor",
  electric_lift: "electric_lift",
  gas_lift: "gas_lift",
  coil_spring: "coil_spring",
};

function touched(cells: Record<string, CellValue>, blank: Record<string, CellValue>, row: number): boolean {
  for (const [addr, value] of Object.entries(cells)) {
    if (rowOf(addr) !== row) continue;
    if (value == null || value === "" || value === false) continue;
    if (value === blank[addr]) continue;
    return true;
  }
  return false;
}

function nearby(cells: Record<string, CellValue>, row: number, resultAddr: string): { spec: string; actual: string } {
  const values = ["B", "C", "D", "E", "F", "G"]
    .map((col) => `${col}${row}`)
    .filter((addr) => addr !== resultAddr)
    .map((addr) => cells[addr])
    .filter((value) => value != null && value !== "" && value !== false)
    .map((value) => String(value));
  if (values.length === 0) return { spec: "(blank)", actual: "(blank)" };
  if (values.length === 1) return { spec: "(blank)", actual: values[0]! };
  return { spec: values[0]!, actual: values[values.length - 1]! };
}

function otherRows(formType: string, cells: Record<string, CellValue>): FailedMeasurement[] {
  const batch = BATCH[formType];
  const blank = batch ? blankBatch(batch) : formType === "fuel_injector" ? blankInjectorCells() : formType === "brake_wear" ? blankBrakeCells() : null;
  const graded = batch ? evaluateBatch(batch, cells) : formType === "fuel_injector" ? evaluateInjector(cells) : formType === "brake_wear" ? evaluateBrake(cells) : null;
  if (!blank || !graded) return [];
  const rows: FailedMeasurement[] = [];
  for (const [addr, value] of Object.entries(graded)) {
    if (!/^fail/i.test(String(value ?? ""))) continue;
    const row = rowOf(addr);
    if (!touched(cells, blank, row)) continue;
    const pair = nearby(cells, row, addr);
    rows.push({ addr, measurement: `Row ${row}`, spec: pair.spec, actual: pair.actual });
    if (rows.length >= 40) break;
  }
  return rows;
}

/** Failed measurements for an optional NCR. Blank sheets stay empty. */
export function failedValidationRows(formType: string, cells: Record<string, CellValue>): FailedMeasurement[] {
  if (formType === "csa" || formType === "fuel_pump" || formType === "air_strut" || formType === "air_spring") {
    if (headerStatusFor(formType, cells) !== "Fail") return [];
    const rows = formType === "csa" ? csaRows(cells) : formType === "fuel_pump" ? fuelRows(cells) : airLabelRows(formType, cells);
    return rows.length > 0 ? rows.slice(0, 40) : [{ addr: "overall", measurement: "Overall result", spec: "Pass", actual: "Fail" }];
  }
  return otherRows(formType, cells);
}

export function partLabel(formType: string, cells: Record<string, CellValue>): string {
  const addr = formType === "fuel_pump" ? "B6" : "B6";
  const value = cells[addr];
  return value == null ? "" : String(value).trim();
}
