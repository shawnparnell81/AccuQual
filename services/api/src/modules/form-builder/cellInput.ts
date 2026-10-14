/**
 * Checks text against a grid cell's type. No imports, so the web build can use the same file the API does.
 * The text is never changed or dropped: on a failure the caller keeps what the person typed and shows the message.
 */

export const CELL_TYPES = ["label", "text", "number", "date", "passfail", "dropdown", "signature"] as const;
export type CellType = (typeof CELL_TYPES)[number];

export const MAX_DROPDOWN_OPTIONS = 50;
export const MAX_DECIMALS = 6;

/** The parts of a grid cell that decide what it accepts. */
export interface CellInputRules {
  type?: CellType;
  options?: string[];
  decimals?: number;
  min?: number;
  max?: number;
}

export type CellInputResult = { ok: true; value: string } | { ok: false; message: string };

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PASS_FAIL = new Set(["pass", "fail", "passed", "failed"]);

function decimalsIn(text: string): number {
  const mantissa = text.toLowerCase().split("e")[0] ?? text;
  const dot = mantissa.indexOf(".");
  return dot < 0 ? 0 : mantissa.length - dot - 1;
}

function validDate(text: string): boolean {
  const match = ISO_DATE.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** An empty entry is always fine. A cell with no type, or a text, label or signature cell, accepts anything. */
export function checkCellInput(cell: CellInputRules, text: string): CellInputResult {
  const value = text.trim();
  if (value === "") return { ok: true, value: "" };

  if (cell.type === "number") {
    if (!NUMBER.test(value)) return { ok: false, message: "Enter a number" };
    const number = Number(value);
    if (!Number.isFinite(number)) return { ok: false, message: "Enter a number" };
    if (cell.min != null && number < cell.min) return { ok: false, message: `Enter a number that is ${cell.min} or more` };
    if (cell.max != null && number > cell.max) return { ok: false, message: `Enter a number that is ${cell.max} or less` };
    if (cell.decimals != null && decimalsIn(value) > cell.decimals) {
      return { ok: false, message: cell.decimals === 0 ? "Enter a whole number" : `Use at most ${cell.decimals} decimal place${cell.decimals === 1 ? "" : "s"}` };
    }
    return { ok: true, value };
  }

  if (cell.type === "date") {
    return validDate(value) ? { ok: true, value } : { ok: false, message: "Enter a date as YYYY-MM-DD" };
  }

  if (cell.type === "dropdown") {
    const options = cell.options ?? [];
    return options.includes(value) ? { ok: true, value } : { ok: false, message: options.length ? `Choose one of: ${options.join(", ")}` : "Add options for this dropdown" };
  }

  if (cell.type === "passfail") {
    return PASS_FAIL.has(value.toLowerCase()) ? { ok: true, value } : { ok: false, message: "Enter Pass or Fail" };
  }

  return { ok: true, value };
}
