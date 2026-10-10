import { blankCells as springBlank, evaluate as springEvaluate, FORMULA_TEXT as springFormulas } from "./airSpringReport";
import { blankCells as strutBlank, evaluate as strutEvaluate, FORMULA_TEXT as strutFormulas } from "./airStrutReport";
import { blankCells as fuelBlank, evaluate as fuelEvaluate, FORMULA_TEXT as fuelFormulas } from "./fuelPumpReport";
import type { CellValue } from "./validationReport";
import { blankCells as csaBlank, evaluate as csaEvaluate, FORMULA_TEXT as csaFormulas } from "./validationReport";

export type HeaderStatus = "Not started" | "In progress" | "Pass" | "Fail";

const GRADE = /^(pass|fail|passed|failed)$/i;

interface SheetSpec {
  blank: () => Record<string, CellValue>;
  formulas: Record<string, string>;
  evaluate: (cells: Record<string, CellValue>) => Record<string, CellValue>;
  disposition: string[];
  /** Overall formulas. They are not grade slots. A blank sheet can still say Passed. */
  overall: string[];
}

const SHEETS: Record<string, SheetSpec> = {
  csa: { blank: csaBlank, formulas: csaFormulas, evaluate: csaEvaluate, disposition: ["B51", "D51", "F51"], overall: ["A1"] },
  fuel_pump: { blank: fuelBlank, formulas: fuelFormulas, evaluate: fuelEvaluate, disposition: ["C52", "E52", "H52"], overall: ["J2", "B51"] },
  air_strut: { blank: strutBlank, formulas: strutFormulas, evaluate: strutEvaluate, disposition: ["F84"], overall: ["G7"] },
  air_spring: { blank: springBlank, formulas: springFormulas, evaluate: springEvaluate, disposition: ["F48"], overall: ["G7", "B48"] },
};

function same(left: CellValue | undefined, right: CellValue | undefined): boolean {
  if (left == null || left === "") return right == null || right === "";
  return left === right;
}

function refs(formula: string): string[] {
  return [...formula.matchAll(/\b([A-Z]{1,3}\d+)\b/g)].map((match) => match[1]!);
}

function isGradeFormula(formula: string): boolean {
  return /pass|fail/i.test(formula);
}

function leaves(addr: string, formulas: Record<string, string>, blank: Record<string, CellValue>, seen: Set<string>): string[] {
  const formula = formulas[addr];
  if (!formula) {
    const base = blank[addr];
    return base == null || base === "" ? [addr] : [];
  }
  if (seen.has(addr)) return [];
  seen.add(addr);
  const out: string[] = [];
  for (const ref of refs(formula)) out.push(...leaves(ref, formulas, blank, seen));
  return out;
}

function filled(cells: Record<string, CellValue>, addr: string): boolean {
  const value = cells[addr];
  return value != null && value !== "";
}

function hasUserData(cells: Record<string, CellValue>, blank: Record<string, CellValue>, formulas: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(blank), ...Object.keys(cells)]);
  for (const key of keys) {
    if (key in formulas) continue;
    if (!same(cells[key], blank[key])) return true;
  }
  return false;
}

function statusFromSheet(spec: SheetSpec, cells: Record<string, CellValue>): HeaderStatus {
  const blank = spec.blank();
  if (!hasUserData(cells, blank, spec.formulas)) return "Not started";
  const graded = spec.evaluate(cells);
  const dispositionChosen = spec.disposition.some((addr) => cells[addr] === true);
  let failed = false;
  let complete = dispositionChosen && spec.disposition.length > 0;
  for (const [addr, formula] of Object.entries(spec.formulas)) {
    if (spec.overall.includes(addr) || !isGradeFormula(formula)) continue;
    const need = [...new Set(leaves(addr, spec.formulas, blank, new Set()))];
    const na = need.some((leaf) => String(cells[leaf] ?? "").trim().toUpperCase() === "NA");
    const ready = need.every((leaf) => filled(cells, leaf)) || na;
    const result = String(graded[addr] ?? "");
    if (!ready || !GRADE.test(result)) {
      complete = false;
      continue;
    }
    if (/^fail/i.test(result)) failed = true;
  }
  if (!complete) return "In progress";
  return failed ? "Fail" : "Pass";
}

function generic(cells: Record<string, CellValue>): HeaderStatus {
  const started = Object.values(cells).some((value) => value != null && value !== "" && value !== false);
  return started ? "In progress" : "Not started";
}

/** Header pill only. Sheet disposition cells stay on the template. */
export function headerStatusFor(formType: string, cells: Record<string, CellValue>): HeaderStatus {
  const spec = SHEETS[formType];
  return spec ? statusFromSheet(spec, cells) : generic(cells);
}
