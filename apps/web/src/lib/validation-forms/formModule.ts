import {
  CYCLE,
  addr as makeAddr,
  evaluateFormula,
  isError,
  numberText,
  parseAddr,
  parseTyped,
  parseRange,
  shiftFormula,
  showValue,
  XlError,
  type CustomFunction,
  type Value,
} from "./engine";
import type { LayoutCell, LayoutStyle, WorkbookLayout } from "./layoutTypes";

/** What a validation form saves in data.cells: the cells a person typed into, by workbook address. */
export type CellValue = string | number | boolean;
export type Cells = Record<string, CellValue>;
/** Every formula cell's value, by address. */
export type Values = Record<string, Value>;

export type CellKind = "label" | "input" | "area" | "select" | "check" | "calc" | "blocked" | "spacer" | "signature" | "tick";

/** A place on the sheet that holds an authorized signature (a PIN stamp), written to data under `path`. */
export interface SignatureSlot {
  addr: string;
  path: string;
  certify: string;
}

/** A scatter chart the workbook has on a second tab, with the run's header fields and its data points. */
export interface GraphSpec {
  title: string;
  xLabel: string;
  yLabel: string;
  /** The run header fields shown above the point table, in order. */
  fields: string[];
}

export interface FormDefinition {
  /** the formType saved on a report: "shock", "electric_lift", ... */
  type: string;
  docId: string;
  title: string;
  /** The workbook's Rev. A saved record keeps the revision it was saved under. */
  revision: string;
  passFill: string;
  /** The words this form uses for a good and a bad result. */
  words: { pass: string; fail: string };
  layout: WorkbookLayout;
  /** The cell that reads "Doc ID: ..." and the one that reads "Rev: ...". They show the record number and revision. */
  docIdCell?: string;
  revCell?: string;
  /**
   * Formulas that replace or add to the workbook's, by address, in Excel syntax without the leading =. null removes one.
   * Every difference from the workbook is listed here, so it is easy to review.
   */
  formulas?: Record<string, string | null>;
  /** Cells a person fills in that the layout alone would not show as inputs (a prefilled name, a typed spec). */
  inputs?: string[];
  /** Cells to leave as plain text or locked, although the layout alone would make them inputs. */
  locked?: string[];
  /** Cells whose gray "not applicable" fill is taken off because the form now gives them a result or a dropdown. */
  clearFill?: string[];
  /** Extra dropdowns, by address. */
  lists?: Record<string, string[]>;
  /** Extra checkboxes, by address. */
  checks?: string[];
  /** Text cells such as "[ ] APPROVED WITH DEVIATION" a person ticks by clicking; the tick is saved as true or false. */
  ticks?: string[];
  /**
   * Changes to the workbook's layout that the app needs and the workbook does not have (a new result cell, a new column).
   * Use addStyle/addCell below so the change is easy to see. The workbook's layout file is never edited by hand.
   */
  patchLayout?: (layout: WorkbookLayout) => WorkbookLayout;
  /** Cells that are a text area (several lines). */
  areas?: string[];
  /** Starting values for editable cells (for example the workbook's prefilled inspector). */
  defaults?: Cells;
  signatures?: SignatureSlot[];
  /** Functions this form's own formulas may call. */
  functions?: Record<string, CustomFunction>;
  /** Cells that carry the sheet's overall result; the first is what the header badge shows. */
  resultCells: string[];
  /** Cells whose text is the form's overall disposition (used for the header badge and the list). */
  graph?: GraphSpec;
}

export interface FormModule {
  def: FormDefinition;
  kinds: Record<string, CellKind>;
  /** the final formulas (workbook plus overrides) by address */
  formulas: Record<string, string>;
  lists: Record<string, string[]>;
  blank: () => Cells;
  /** The saved cells of a report, over the blank sheet. Unknown cells are dropped. */
  cellsFromData: (data: unknown) => Cells;
  evaluate: (cells: Cells) => Values;
  /** "Pass", "Fail" or "" for the header badge and lists. */
  status: (values: Values) => "Pass" | "Fail" | "";
  /** The fill, font color and bold a conditional-format rule gives a cell, if any. */
  conditionalStyle: (addr: string, values: Values, cells: Cells) => { bg?: string; fg?: string; b?: boolean } | null;
  /** The text a cell shows for a value, following the workbook's number format. */
  display: (addr: string, value: Value | CellValue | undefined) => string;
}

function grayish(hex: string | undefined): boolean {
  if (!hex) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return Math.abs(r - g) < 14 && Math.abs(g - b) < 14 && r >= 140 && r <= 215;
}

function hasBorder(style: LayoutStyle | undefined): boolean {
  return Boolean(style?.border && Object.keys(style.border).length > 0);
}

/** Excel number formats the forms use, applied to a number. Anything else shows the plain number. */
export function formatNumber(value: number, format: string | undefined): string {
  if (!format) return numberText(value);
  const percent = /%$/.test(format);
  const decimals = /\.(0+)/.exec(format)?.[1]?.length ?? 0;
  const scaled = percent ? value * 100 : value;
  const fixed = scaled.toFixed(decimals);
  const body = /#,##0/.test(format) ? Number(fixed).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : fixed;
  return percent ? `${body}%` : body;
}

/** The layout with the gray fill removed from some cells. The workbook's own layout is never edited. */
function withClearedFill(layout: WorkbookLayout, addrs: string[]): WorkbookLayout {
  const styles = [...layout.styles];
  const cells = { ...layout.cells };
  const cleared = new Map<number, number>();
  for (const at of addrs) {
    const cell = cells[at];
    if (!cell) continue;
    let next = cleared.get(cell.s);
    if (next == null) {
      const { bg: _bg, ...rest } = layout.styles[cell.s] ?? {};
      void _bg;
      styles.push(rest);
      next = styles.length - 1;
      cleared.set(cell.s, next);
    }
    cells[at] = { ...cell, s: next };
  }
  return { ...layout, styles, cells };
}

/** Adds a style to a layout and returns its index, for a cell the app adds. */
export function addStyle(layout: WorkbookLayout, style: LayoutStyle): { layout: WorkbookLayout; index: number } {
  const found = layout.styles.findIndex((existing) => JSON.stringify(existing) === JSON.stringify(style));
  if (found >= 0) return { layout, index: found };
  return { layout: { ...layout, styles: [...layout.styles, style] }, index: layout.styles.length };
}

/** Adds (or replaces) a cell, growing the sheet's width or height when the address is outside it. */
export function addCell(layout: WorkbookLayout, at: string, cell: LayoutCell, colWidth = 14): WorkbookLayout {
  const pos = parseAddr(at);
  if (!pos) return layout;
  const cols = [...layout.cols];
  while (cols.length < pos.col) cols.push(colWidth);
  return { ...layout, cells: { ...layout.cells, [at]: cell }, cols, maxCol: Math.max(layout.maxCol, pos.col), maxRow: Math.max(layout.maxRow, pos.row) };
}

export function buildForm(input: FormDefinition): FormModule {
  let layout = input.layout;
  if (input.patchLayout) layout = input.patchLayout(layout);
  if (input.clearFill?.length) layout = withClearedFill(layout, input.clearFill);
  const def: FormDefinition = { ...input, layout };

  const formulas: Record<string, string> = {};
  for (const [at, cell] of Object.entries(layout.cells)) if (cell.f) formulas[at] = cell.f;
  for (const [at, formula] of Object.entries(def.formulas ?? {})) {
    if (formula == null) delete formulas[at];
    else formulas[at] = formula;
  }

  const lists: Record<string, string[]> = { ...layout.lists, ...(def.lists ?? {}) };
  const covered = new Set<string>();
  for (const merge of layout.merges) {
    const range = parseRange(merge);
    if (!range) continue;
    for (let row = range.r1; row <= range.r2; row += 1) {
      for (let col = range.c1; col <= range.c2; col += 1) if (row !== range.r1 || col !== range.c1) covered.add(makeAddr(col, row));
    }
  }
  // An empty merged band across the whole width is a spacer between sections, not a place to type.
  const bands = new Set<string>();
  for (const merge of layout.merges) {
    const range = parseRange(merge);
    if (range && range.c1 === 1 && range.c2 >= layout.maxCol) bands.add(makeAddr(range.c1, range.r1));
  }
  const extraInputs = new Set(def.inputs ?? []);
  const tickCells = new Set(def.ticks ?? []);
  const locked = new Set(def.locked ?? []);
  const extraChecks = new Set(def.checks ?? []);
  const areas = new Set(def.areas ?? []);
  const signatureAt = new Map((def.signatures ?? []).map((slot) => [slot.addr, slot]));

  const kinds: Record<string, CellKind> = {};
  const styleOf = (cell: LayoutCell | undefined) => layout.styles[cell?.s ?? 0];
  for (const [at, cell] of Object.entries(layout.cells)) {
    if (covered.has(at)) continue;
    const style = styleOf(cell);
    let kind: CellKind;
    if (signatureAt.has(at)) kind = "signature";
    else if (formulas[at]) kind = "calc";
    else if (tickCells.has(at)) kind = "tick";
    else if (lists[at]) kind = "select";
    else if (typeof cell.v === "boolean" || extraChecks.has(at)) kind = "check";
    else if (areas.has(at)) kind = "area";
    else if (extraInputs.has(at)) kind = "input";
    else if (locked.has(at)) kind = cell.v != null && cell.v !== "" ? "label" : "blocked";
    else if (cell.v != null && cell.v !== "") kind = "label";
    else if (bands.has(at) && !extraInputs.has(at)) kind = "spacer";
    else if (grayish(style?.bg)) kind = "blocked";
    else if (hasBorder(style)) kind = "input";
    else kind = "spacer";
    kinds[at] = kind;
  }
  // Overrides can reach a cell the workbook left unstyled.
  for (const at of [...Object.keys(def.formulas ?? {}), ...extraInputs, ...Object.keys(def.lists ?? {}), ...extraChecks, ...signatureAt.keys()]) {
    if (kinds[at] || covered.has(at)) continue;
    kinds[at] = signatureAt.has(at) ? "signature" : formulas[at] ? "calc" : lists[at] ? "select" : extraChecks.has(at) ? "check" : "input";
  }
  for (const at of Object.keys(def.formulas ?? {})) if (formulas[at] && kinds[at] !== "signature") kinds[at] = "calc";
  for (const at of Object.keys(def.formulas ?? {})) if (!formulas[at] && kinds[at] === "calc") kinds[at] = layout.cells[at]?.v != null ? "label" : "input";

  const inputKinds = new Set<CellKind>(["input", "area", "select", "check", "tick"]);
  const isInput = (at: string) => inputKinds.has(kinds[at] ?? "spacer");

  function blank(): Cells {
    return { ...(def.defaults ?? {}) };
  }

  function cellsFromData(data: unknown): Cells {
    const out = blank();
    const saved = data && typeof data === "object" ? (data as { cells?: unknown }).cells : undefined;
    if (saved && typeof saved === "object") {
      for (const [at, value] of Object.entries(saved as Record<string, unknown>)) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[at] = value;
      }
    }
    return out;
  }

  function constantOf(at: string): Value {
    const v = layout.cells[at]?.v;
    return v === undefined ? null : v;
  }

  function evaluate(cells: Cells): Values {
    const memo = new Map<string, Value>();
    const stack = new Set<string>();
    const read = (col: number, row: number): Value => {
      const at = makeAddr(col, row);
      if (formulas[at]) {
        if (memo.has(at)) return memo.get(at)!;
        if (stack.has(at)) return CYCLE;
        stack.add(at);
        const value = evaluateFormula(formulas[at]!, ctx);
        stack.delete(at);
        memo.set(at, value);
        return value;
      }
      if (at in cells) {
        const typed = cells[at];
        if (typed === "" || typed === undefined) return isInput(at) ? null : constantOf(at);
        // A cell is stored as typed. A number typed in stays a number for the formulas, as in Excel.
        return typeof typed === "string" ? parseTyped(typed) : typed;
      }
      return constantOf(at);
    };
    const ctx = { cell: read, maxRow: layout.maxRow, functions: def.functions };
    const out: Values = {};
    for (const at of Object.keys(formulas)) {
      const pos = parseAddr(at);
      if (pos) out[at] = read(pos.col, pos.row);
    }
    return out;
  }

  /** The value of any cell, formula or typed, for conditional formats. */
  function valueReader(cells: Cells, values: Values) {
    return (col: number, row: number): Value => {
      const at = makeAddr(col, row);
      if (at in values) return values[at]!;
      if (at in cells) {
        const typed = cells[at];
        return typed === "" || typed === undefined ? null : typeof typed === "string" ? parseTyped(typed) : typed;
      }
      return constantOf(at);
    };
  }

  const conditional = layout.conditional.map((block) => ({
    ...block,
    ranges: block.ranges.map((ref) => parseRange(ref)).filter((range): range is NonNullable<ReturnType<typeof parseRange>> => range != null),
  }));

  function conditionalStyle(at: string, values: Values, cells: Cells) {
    const pos = parseAddr(at);
    if (!pos) return null;
    let result = null as { bg?: string; fg?: string; b?: boolean } | null;
    const read = valueReader(cells, values);
    for (const block of conditional) {
      if (!block.ranges.some((range) => pos.col >= range.c1 && pos.col <= range.c2 && pos.row >= range.r1 && pos.row <= range.r2)) continue;
      // A rule is written for the top-left cell of everything it applies to (the corner of all its ranges together).
      const originRow = Math.min(...block.ranges.map((range) => range.r1));
      const originCol = Math.min(...block.ranges.map((range) => range.c1));
      for (const rule of block.rules) {
        const shifted = shiftFormula(rule.f, pos.row - originRow, pos.col - originCol);
        const hit = evaluateFormula(shifted, { cell: read, maxRow: layout.maxRow, functions: def.functions });
        if (hit === true) {
          result = { ...(result ?? {}), bg: result?.bg ?? rule.bg, fg: result?.fg ?? rule.fg, b: result?.b ?? (rule.b ? true : undefined) };
          if (rule.stop) return result;
        }
      }
    }
    return result;
  }

  function status(values: Values): "Pass" | "Fail" | "" {
    const text = showValue(values[def.resultCells[0] ?? ""]).trim().toLowerCase();
    if (text === def.words.pass.toLowerCase() || text === "pass" || text === "passed") return "Pass";
    if (text === def.words.fail.toLowerCase() || text === "fail" || text === "failed") return "Fail";
    return "";
  }

  function display(at: string, value: Value | CellValue | undefined): string {
    if (value == null || value === "") return "";
    if (value instanceof XlError || isError(value)) return value.code;
    if (typeof value === "number") return formatNumber(value, layout.styles[layout.cells[at]?.s ?? 0]?.nf);
    return showValue(value as Value);
  }

  return { def, kinds, formulas, lists, blank, cellsFromData, evaluate, status, conditionalStyle, display };
}
