/**
 * Setup copied onto a new FAI or validation record.
 * Results, signatures, approvals, and history stay behind.
 */

export interface CopiedLine {
  sortOrder: number;
  balloon: string | null;
  name: string;
  mode: string;
  nominal: string | null;
  percent: string | null;
  plusTolerance: string | null;
  minusTolerance: string | null;
  specMin: string | null;
  specMax: string | null;
  limitLow: string | null;
  limitHigh: string | null;
  actual: null;
  attributeResult: null;
  result: "";
}

export function copyCharacteristicLine(line: {
  sortOrder: number;
  balloon: string | null;
  name: string;
  mode: string;
  nominal: string | null;
  percent: string | null;
  plusTolerance: string | null;
  minusTolerance: string | null;
  specMin: string | null;
  specMax: string | null;
  limitLow: string | null;
  limitHigh: string | null;
  actual?: string | null;
  attributeResult?: string | null;
  result?: string | null;
}): CopiedLine {
  return {
    sortOrder: line.sortOrder,
    balloon: line.balloon,
    name: line.name,
    mode: line.mode,
    nominal: line.nominal,
    percent: line.percent,
    plusTolerance: line.plusTolerance,
    minusTolerance: line.minusTolerance,
    specMin: line.specMin,
    specMax: line.specMax,
    limitLow: line.limitLow,
    limitHigh: line.limitHigh,
    actual: null,
    attributeResult: null,
    result: "",
  };
}

const SIGNATURE_KEY = /signature|approvedby|authorized/i;

/** Header and limit cells. Sample readings, pass/fail, signatures, and notes from the inspection stay off the copy. */
export function copyValidationCells(formType: string, cells: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const next: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(cells)) {
    if (!isValidationSetupCell(formType, key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) next[key] = value;
  }
  return next;
}

/** Limit text copied onto a new CSA or fuel-pump record. Results are not part of this object. */
export function cleanLimitOverrides(value: unknown): Record<string, { specifiedLimits: string; units: string | null }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, { specifiedLimits: string; units: string | null }> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const specified = (raw as { specifiedLimits?: unknown }).specifiedLimits;
    const units = (raw as { units?: unknown }).units;
    if (typeof specified !== "string" || !specified.trim()) continue;
    out[key] = { specifiedLimits: specified.trim(), units: typeof units === "string" && units.trim() ? units.trim() : null };
  }
  return out;
}

export function validationPartNumber(cells: Record<string, unknown>): string {
  const value = cells.B6;
  return typeof value === "string" ? value.trim() : "";
}

function columnOf(addr: string): string | null {
  const match = /^([A-Z]+)\d+$/.exec(addr);
  return match ? match[1]! : null;
}

function rowOf(addr: string): number | null {
  const match = /^[A-Z]+(\d+)$/.exec(addr);
  return match ? Number(match[1]) : null;
}

/**
 * Setup is the header identity plus nominal, tolerance, and limit columns.
 * Sample, result, disposition, signature, batch, inspector, and date cells are this inspection's data.
 */
export function isValidationSetupCell(formType: string, key: string): boolean {
  if (SIGNATURE_KEY.test(key)) return false;
  if (formType === "fuel_pump") return fuelPumpSetup(key);
  if (formType === "csa" || formType === "") return csaSetup(key);
  return genericSetup(key);
}

function csaSetup(key: string): boolean {
  if (["B6", "F6", "B7"].includes(key)) return true;
  const column = columnOf(key);
  const row = rowOf(key);
  if (!column || row == null) return false;
  if (row < 12 || row > 46) return false;
  return column === "B" || column === "C";
}

function fuelPumpSetup(key: string): boolean {
  if (["B6", "G6", "B7", "B29"].includes(key)) return true;
  const column = columnOf(key);
  const row = rowOf(key);
  if (!column || row == null) return false;
  if (row >= 13 && row <= 24) return column === "A" || column === "B" || column === "D";
  if (row >= 30 && row <= 34) return column === "B" || column === "C" || column === "D";
  if (row >= 46 && row <= 48) return column === "B";
  return false;
}

function genericSetup(key: string): boolean {
  if (key === "B6" || key === "F6" || key === "B7") return true;
  const column = columnOf(key);
  const row = rowOf(key);
  if (!column || row == null || row < 12) return false;
  return column === "B" || column === "C";
}
