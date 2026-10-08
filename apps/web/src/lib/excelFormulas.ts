/**
 * Cell formulas for forms built in the app.
 * The CSA and fuel-pump sheets keep their own evaluators. This one is the
 * general engine those sheets' functions (SUM, AVERAGE, IF, MIN, MAX, ROUND,
 * cell references, and ranges) need when the layout is not hardcoded.
 */

/** `null` is an empty cell. It is not zero, and it is not a typed empty string. */
export type FormulaValue = string | number | boolean | null;

const DIV0 = "#DIV/0!";
const VALUE = "#VALUE!";
const REF = "#REF!";
const NAME = "#NAME?";
const CYCLE = "#CYCLE!";
const NUM = "#NUM!";

const ERRORS = new Set([DIV0, VALUE, REF, NAME, CYCLE, NUM]);

export function isFormulaError(value: FormulaValue | null | undefined): boolean {
  return typeof value === "string" && ERRORS.has(value);
}

interface Token {
  kind: "num" | "str" | "id" | "op" | "lp" | "rp" | "comma" | "eof";
  text: string;
  num?: number;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === " " || ch === "\t" || ch === "\n") {
      i += 1;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lp", text: ch });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rp", text: ch });
      i += 1;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "comma", text: ch });
      i += 1;
      continue;
    }
    if (ch === '"') {
      let text = "";
      i += 1;
      while (i < source.length) {
        if (source[i] === '"') {
          if (source[i + 1] === '"') {
            text += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        text += source[i];
        i += 1;
      }
      tokens.push({ kind: "str", text });
      continue;
    }
    const op = source.slice(i, i + 2);
    if (op === "<=" || op === ">=" || op === "<>") {
      tokens.push({ kind: "op", text: op });
      i += 2;
      continue;
    }
    if ("+-*/^=<>&".includes(ch)) {
      tokens.push({ kind: "op", text: ch });
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let raw = "";
      while (i < source.length && /[0-9.]/.test(source[i]!)) {
        raw += source[i];
        i += 1;
      }
      if (source[i] === "%") {
        tokens.push({ kind: "num", text: raw + "%", num: Number(raw) / 100 });
        i += 1;
      } else {
        tokens.push({ kind: "num", text: raw, num: Number(raw) });
      }
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let raw = "";
      while (i < source.length && /[A-Za-z0-9_$]/.test(source[i]!)) {
        raw += source[i];
        i += 1;
      }
      tokens.push({ kind: "id", text: raw });
      continue;
    }
    tokens.push({ kind: "op", text: ch });
    i += 1;
  }
  tokens.push({ kind: "eof", text: "" });
  return tokens;
}

function columnIndex(letters: string): number {
  let col = 0;
  for (const ch of letters.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return col;
}

export function columnLetters(index: number): string {
  let n = index;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

const CELL_REF = /^\$?([A-Za-z]+)\$?(\d+)$/;

export function parseCellRef(text: string): { col: number; row: number } | null {
  const match = CELL_REF.exec(text.trim());
  if (!match) return null;
  const col = columnIndex(match[1]!);
  const row = Number(match[2]);
  if (!Number.isFinite(row) || row < 1 || col < 1) return null;
  return { col, row };
}

function cellKey(col: number, row: number): string {
  return `${columnLetters(col)}${row}`;
}

type CellMap = Record<string, string>;

class Parser {
  private tokens: Token[];
  private index = 0;
  private cells: CellMap;
  private stack: string[];
  private cache: Map<string, FormulaValue>;

  constructor(tokens: Token[], cells: CellMap, stack: string[], cache: Map<string, FormulaValue>) {
    this.tokens = tokens;
    this.cells = cells;
    this.stack = stack;
    this.cache = cache;
  }

  private peek(): Token {
    return this.tokens[this.index] ?? { kind: "eof", text: "" };
  }

  private take(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }

  parse(): FormulaValue {
    const value = this.parseCompare();
    if (this.peek().kind !== "eof") return VALUE;
    return value;
  }

  private parseCompare(): FormulaValue {
    let left = this.parseConcat();
    while (this.peek().kind === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(this.peek().text)) {
      const op = this.take().text;
      const right = this.parseConcat();
      left = compare(left, op, right);
    }
    return left;
  }

  private parseConcat(): FormulaValue {
    let left = this.parseSum();
    while (this.peek().kind === "op" && this.peek().text === "&") {
      this.take();
      const right = this.parseSum();
      left = show(left) + show(right);
    }
    return left;
  }

  private parseSum(): FormulaValue {
    let left = this.parseProduct();
    while (this.peek().kind === "op" && (this.peek().text === "+" || this.peek().text === "-")) {
      const op = this.take().text;
      const right = this.parseProduct();
      const result = numOp(left, right, op === "+" ? (a, b) => a + b : (a, b) => a - b);
      if (typeof result === "string") return result;
      left = result;
    }
    return left;
  }

  private parseProduct(): FormulaValue {
    let left = this.parseUnary();
    while (this.peek().kind === "op" && (this.peek().text === "*" || this.peek().text === "/")) {
      const op = this.take().text;
      const right = this.parseUnary();
      const result = numOp(left, right, (a, b) => (op === "*" ? a * b : b === 0 ? DIV0 : a / b));
      if (result === DIV0 || typeof result === "string") return result;
      left = result;
    }
    return left;
  }

  private parseUnary(): FormulaValue {
    if (this.peek().kind === "op" && (this.peek().text === "-" || this.peek().text === "+")) {
      const op = this.take().text;
      const value = this.parseUnary();
      if (typeof value === "string" && ERRORS.has(value)) return value;
      const n = toNumber(value);
      if (n == null) return VALUE;
      return op === "-" ? -n : n;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): FormulaValue {
    const token = this.peek();
    if (token.kind === "num") {
      this.take();
      return Number.isFinite(token.num) ? token.num! : VALUE;
    }
    if (token.kind === "str") {
      this.take();
      return token.text;
    }
    if (token.kind === "lp") {
      this.take();
      const value = this.parseCompare();
      if (this.peek().kind !== "rp") return VALUE;
      this.take();
      return value;
    }
    if (token.kind === "id") {
      this.take();
      const upper = token.text.toUpperCase();
      if (upper === "TRUE") return true;
      if (upper === "FALSE") return false;
      if (this.peek().kind === "lp") return this.parseCall(upper);
      const ref = parseCellRef(token.text);
      if (!ref) return NAME;
      return readCell(this.cells, this.stack, this.cache, cellKey(ref.col, ref.row));
    }
    return VALUE;
  }

  private parseCall(name: string): FormulaValue {
    this.take();
    const args: Argument[] = [];
    if (this.peek().kind !== "rp") {
      args.push(this.parseArg());
      while (this.peek().kind === "comma") {
        this.take();
        args.push(this.parseArg());
      }
    }
    if (this.peek().kind !== "rp") return VALUE;
    this.take();
    return applyFunction(name, args, this.cells, this.stack, this.cache);
  }

  private parseArg(): Argument {
    const token = this.peek();
    if (token.kind === "id") {
      const next = this.tokens[this.index + 1];
      if (next?.kind === "op" && next.text === ":") {
        const start = parseCellRef(token.text);
        const endToken = this.tokens[this.index + 2];
        const end = endToken?.kind === "id" ? parseCellRef(endToken.text) : null;
        if (start && end) {
          this.index += 3;
          return { kind: "range", start, end };
        }
      }
    }
    return { kind: "value", value: this.parseCompare() };
  }
}

interface CellPos {
  col: number;
  row: number;
}

type Argument = { kind: "value"; value: FormulaValue } | { kind: "range"; start: CellPos; end: CellPos };

function rangeCells(start: CellPos, end: CellPos): string[] {
  const c1 = Math.min(start.col, end.col);
  const c2 = Math.max(start.col, end.col);
  const r1 = Math.min(start.row, end.row);
  const r2 = Math.max(start.row, end.row);
  if (c2 - c1 > 80 || r2 - r1 > 500) return [];
  const keys: string[] = [];
  for (let row = r1; row <= r2; row += 1) {
    for (let col = c1; col <= c2; col += 1) keys.push(cellKey(col, row));
  }
  return keys;
}

function readCell(cells: CellMap, stack: string[], cache: Map<string, FormulaValue>, key: string): FormulaValue {
  const normalized = key.toUpperCase();
  const cached = cache.get(normalized);
  if (cached !== undefined) return cached;
  if (stack.includes(normalized)) return CYCLE;
  const raw = lookup(cells, normalized);
  if (raw == null || raw === "") {
    cache.set(normalized, null);
    return null;
  }
  if (raw.startsWith("=")) {
    stack.push(normalized);
    const value = evaluateFormula(raw.slice(1), cells, stack, cache);
    stack.pop();
    cache.set(normalized, value);
    return value;
  }
  const literal = literalValue(raw);
  cache.set(normalized, literal);
  return literal;
}

function lookup(cells: CellMap, key: string): string | undefined {
  if (key in cells) return cells[key];
  const found = Object.keys(cells).find((item) => item.toUpperCase() === key);
  return found == null ? undefined : cells[found];
}

function literalValue(raw: string): FormulaValue {
  const trimmed = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (/^-?\d+(\.\d+)?%$/.test(trimmed)) return Number(trimmed.slice(0, -1)) / 100;
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === "true";
  return trimmed;
}

function evaluateFormula(body: string, cells: CellMap, stack: string[], cache: Map<string, FormulaValue>): FormulaValue {
  try {
    return new Parser(tokenize(body), cells, stack, cache).parse();
  } catch {
    return VALUE;
  }
}

function flatten(args: Argument[], cells: CellMap, stack: string[], cache: Map<string, FormulaValue>): FormulaValue[] {
  const values: FormulaValue[] = [];
  for (const arg of args) {
    if (arg.kind === "value") values.push(arg.value);
    else {
      for (const key of rangeCells(arg.start, arg.end)) values.push(readCell(cells, stack, cache, key));
    }
  }
  return values;
}

function numbersOf(values: FormulaValue[]): number[] | string {
  const nums: number[] = [];
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === "string" && ERRORS.has(value)) return value;
    if (typeof value === "string" && value.trim() === "") continue;
    if (typeof value === "boolean") {
      nums.push(value ? 1 : 0);
      continue;
    }
    const n = toNumber(value);
    if (n == null) continue;
    nums.push(n);
  }
  return nums;
}

function applyFunction(name: string, args: Argument[], cells: CellMap, stack: string[], cache: Map<string, FormulaValue>): FormulaValue {
  const values = () => flatten(args, cells, stack, cache);
  if (name === "SUM" || name === "AVERAGE" || name === "MIN" || name === "MAX" || name === "COUNT") {
    const nums = numbersOf(values());
    if (typeof nums === "string") return nums;
    if (name === "COUNT") return nums.length;
    if (nums.length === 0) {
      if (name === "SUM") return 0;
      if (name === "AVERAGE") return null;
      return DIV0;
    }
    if (name === "SUM") return nums.reduce((sum, n) => sum + n, 0);
    if (name === "AVERAGE") return nums.reduce((sum, n) => sum + n, 0) / nums.length;
    if (name === "MIN") return Math.min(...nums);
    return Math.max(...nums);
  }
  if (name === "ROUND") {
    const list = values();
    const n = toNumber(list[0]);
    const digits = list.length > 1 ? toNumber(list[1]) : 0;
    if (n == null || digits == null) return VALUE;
    const places = Math.trunc(digits);
    if (Math.abs(places) > 10) return NUM;
    const factor = 10 ** places;
    return Math.round(n * factor) / factor;
  }
  if (name === "IF") {
    const list = values();
    if (list.length < 2) return VALUE;
    if (list[0] == null) return null;
    const yes = truthy(list[0]!);
    if (typeof yes === "string") return yes;
    return yes ? list[1]! : (list[2] ?? false);
  }
  if (name === "AND" || name === "OR") {
    const list = values();
    if (list.length === 0) return VALUE;
    let saw = false;
    let sawBlank = false;
    for (const value of list) {
      if (value == null) {
        sawBlank = true;
        continue;
      }
      const flag = truthy(value);
      if (typeof flag === "string") return flag;
      saw = true;
      if (name === "AND" && !flag) return false;
      if (name === "OR" && flag) return true;
    }
    if (sawBlank) return null;
    return saw ? name === "AND" : false;
  }
  if (name === "NOT") {
    const list = values();
    if (list.length === 0) return VALUE;
    const flag = truthy(list[0]!);
    if (typeof flag === "string") return flag;
    return !flag;
  }
  return NAME;
}

function toNumber(value: FormulaValue | undefined): number | null {
  if (value == null) return value === null ? 0 : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    if (ERRORS.has(value)) return null;
    if (value.trim() === "") return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function truthy(value: FormulaValue): boolean | string {
  if (value == null) return false;
  if (typeof value === "string" && ERRORS.has(value)) return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return value.trim() !== "";
}

function show(value: FormulaValue): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

function numOp(left: FormulaValue, right: FormulaValue, op: (a: number, b: number) => number | string): FormulaValue {
  if (typeof left === "string" && ERRORS.has(left)) return left;
  if (typeof right === "string" && ERRORS.has(right)) return right;
  const a = toNumber(left);
  const b = toNumber(right);
  if (a == null || b == null) return VALUE;
  const result = op(a, b);
  if (typeof result === "string") return result;
  if (!Number.isFinite(result)) return NUM;
  return result;
}

function compare(left: FormulaValue, op: string, right: FormulaValue): FormulaValue {
  if (typeof left === "string" && ERRORS.has(left)) return left;
  if (typeof right === "string" && ERRORS.has(right)) return right;
  if (left == null || right == null) return null;
  const aNum = typeof left === "number" || typeof left === "boolean" ? toNumber(left) : typeof right === "number" ? toNumber(left) : null;
  const bNum = typeof right === "number" || typeof right === "boolean" ? toNumber(right) : typeof left === "number" ? toNumber(right) : null;
  let result: boolean;
  if (aNum != null && bNum != null && !(typeof left === "string" && typeof right === "string")) {
    result = op === "=" ? aNum === bNum : op === "<>" ? aNum !== bNum : op === "<" ? aNum < bNum : op === ">" ? aNum > bNum : op === "<=" ? aNum <= bNum : aNum >= bNum;
  } else {
    const a = show(left).toLowerCase();
    const b = show(right).toLowerCase();
    result = op === "=" ? a === b : op === "<>" ? a !== b : op === "<" ? a < b : op === ">" ? a > b : op === "<=" ? a <= b : a >= b;
  }
  return result;
}

/** Evaluates every formula. Literal cells are returned as stored. Blank cells stay blank. */
export function evaluateCells(cells: Record<string, string>): Record<string, FormulaValue> {
  const cache = new Map<string, FormulaValue>();
  const out: Record<string, FormulaValue> = {};
  for (const [key, raw] of Object.entries(cells)) {
    const normalized = key.toUpperCase();
    if (raw == null || raw === "") continue;
    if (raw.startsWith("=")) out[normalized] = readCell(cells, [], cache, normalized);
    else out[normalized] = literalValue(raw);
  }
  return out;
}

export function displayFormulaValue(value: FormulaValue | undefined): string {
  if (value == null || value === "") return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return NUM;
    const rounded = Math.round(value * 1e10) / 1e10;
    return String(rounded);
  }
  return value;
}

/** Passed is the CSA validation green. Failed is red. Other text keeps its own fill. */
export function passFailFill(text: string): { background: string; color: string } | null {
  const label = text.trim().toLowerCase();
  if (label === "passed" || label === "pass") return { background: "#4EA72E", color: "#ffffff" };
  if (label === "failed" || label === "fail") return { background: "#FF0000", color: "#ffffff" };
  return null;
}
