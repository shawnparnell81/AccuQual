/**
 * A small spreadsheet formula engine for the validation forms. The forms' formulas are copied from the Excel workbooks
 * as text and evaluated here, so what the app computes is what the workbook computes. It follows Excel's rules where they
 * matter to these forms:
 *   - a blank cell is 0 in arithmetic and in comparisons, and "" as text;
 *   - text compares without regard to case, and any text is greater than any number;
 *   - an error (#DIV/0!, #VALUE!, ...) passes through a formula until IFERROR or ISERROR looks at it;
 *   - IF evaluates only the branch it takes; a missing else is FALSE;
 *   - COUNT counts numbers, COUNTA counts anything not blank, COUNTIF takes "=x", ">5", "<>x" and wildcards.
 * Supported functions: IF IFERROR AND OR NOT ABS ROUND SUM MIN MAX AVERAGE COUNT COUNTA COUNTIF LET PI POWER SQRT
 * TREND SLOPE SEARCH ISERROR ISNUMBER ISBLANK LEN TRIM UPPER LOWER. A form can add its own functions.
 */

export class XlError {
  constructor(public readonly code: string) {}
  toString(): string {
    return this.code;
  }
}

export const DIV0 = new XlError("#DIV/0!");
export const VALUE = new XlError("#VALUE!");
export const NAME = new XlError("#NAME?");
export const REF = new XlError("#REF!");
export const NUM = new XlError("#NUM!");
export const NA = new XlError("#N/A");
export const CYCLE = new XlError("#CYCLE!");

/** A cell value. null is a blank cell. */
export type Value = number | string | boolean | null | XlError;

export function isError(value: unknown): value is XlError {
  return value instanceof XlError;
}

/** A block of cell values, rows then columns, as handed to a function by a range such as B3:D9. */
export class RangeValue {
  constructor(public readonly rows: Value[][]) {}
  flat(): Value[] {
    return this.rows.flat();
  }
}

export type FunctionArg = Value | RangeValue;
export type CustomFunction = (args: FunctionArg[]) => Value;

/* ---------------- cell addresses ---------------- */

export function columnIndex(letters: string): number {
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

export function parseAddr(addr: string): { col: number; row: number } | null {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(addr.trim());
  if (!match) return null;
  return { col: columnIndex(match[1]!), row: Number(match[2]) };
}

export function addr(col: number, row: number): string {
  return `${columnLetters(col)}${row}`;
}

/** "B3:D9" into its corners, with the corners in order. */
export function parseRange(ref: string): { c1: number; r1: number; c2: number; r2: number } | null {
  const [a, b] = ref.split(":");
  const first = parseAddr(a ?? "");
  const last = parseAddr(b ?? a ?? "");
  if (!first || !last) return null;
  return { c1: Math.min(first.col, last.col), r1: Math.min(first.row, last.row), c2: Math.max(first.col, last.col), r2: Math.max(first.row, last.row) };
}

export function cellsIn(ref: string): string[] {
  const range = parseRange(ref);
  if (!range) return [];
  const out: string[] = [];
  for (let row = range.r1; row <= range.r2; row += 1) for (let col = range.c1; col <= range.c2; col += 1) out.push(addr(col, row));
  return out;
}

/**
 * Moves the relative references in a formula, the way copying a cell does. $ keeps a row or column fixed.
 * Used for shared formulas and for conditional-format rules written for the top-left cell of a range.
 */
export function shiftFormula(formula: string, dRow: number, dCol: number): string {
  let out = "";
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i]!;
    if (ch === '"') {
      let j = i + 1;
      while (j < formula.length && !(formula[j] === '"' && formula[j + 1] !== '"')) j += formula[j] === '"' ? 2 : 1;
      out += formula.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const match = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/.exec(formula.slice(i));
    const before = i > 0 ? formula[i - 1]! : "";
    if (match && !/[A-Za-z0-9_.]/.test(before)) {
      const col = match[1] ? match[2]! : columnLetters(columnIndex(match[2]!) + dCol);
      const row = match[3] ? match[4]! : String(Number(match[4]) + dRow);
      out += `${match[1]}${col}${match[3]}${row}`;
      i += match[0].length;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/* ---------------- tokens and syntax ---------------- */

type Token =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "id"; value: string }
  | { kind: "op"; value: string }
  | { kind: "lp" | "rp" | "comma" | "eof" };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (/\s/.test(ch)) {
      i += 1;
    } else if (ch === "(") {
      tokens.push({ kind: "lp" });
      i += 1;
    } else if (ch === ")") {
      tokens.push({ kind: "rp" });
      i += 1;
    } else if (ch === ",") {
      tokens.push({ kind: "comma" });
      i += 1;
    } else if (ch === '"') {
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
      tokens.push({ kind: "str", value: text });
    } else if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
      const match = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(source.slice(i))!;
      tokens.push({ kind: "num", value: Number(match[0]) });
      i += match[0].length;
    } else if (ch === "#") {
      const match = /^#[A-Za-z0-9/!?]+/.exec(source.slice(i));
      tokens.push({ kind: "id", value: match ? match[0] : "#" });
      i += match ? match[0].length : 1;
    } else if (/[A-Za-z_$]/.test(ch)) {
      const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(i))!;
      tokens.push({ kind: "id", value: match[0] });
      i += match[0].length;
    } else {
      const two = source.slice(i, i + 2);
      if (two === "<=" || two === ">=" || two === "<>") {
        tokens.push({ kind: "op", value: two });
        i += 2;
      } else {
        tokens.push({ kind: "op", value: ch });
        i += 1;
      }
    }
  }
  tokens.push({ kind: "eof" });
  return tokens;
}

type Node =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "err"; v: XlError }
  | { t: "ref"; col: number; row: number }
  | { t: "range"; c1: number; r1: number; c2: number; r2: number }
  | { t: "colrange"; c1: number; c2: number }
  | { t: "name"; name: string }
  | { t: "unary"; op: string; a: Node }
  | { t: "pct"; a: Node }
  | { t: "bin"; op: string; a: Node; b: Node }
  | { t: "call"; name: string; args: Node[] };

const COMPARE = new Set(["=", "<>", "<", ">", "<=", ">="]);

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.index] ?? { kind: "eof" };
  }
  private take(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }
  private isOp(...values: string[]): boolean {
    const token = this.peek();
    return token.kind === "op" && values.includes(token.value);
  }

  parse(): Node {
    const node = this.compare();
    if (this.peek().kind !== "eof") throw new Error("Unexpected text at the end of the formula.");
    return node;
  }

  private compare(): Node {
    let node = this.concat();
    while (this.isOp(...COMPARE)) node = { t: "bin", op: (this.take() as { value: string }).value, a: node, b: this.concat() };
    return node;
  }
  private concat(): Node {
    let node = this.sum();
    while (this.isOp("&")) {
      this.take();
      node = { t: "bin", op: "&", a: node, b: this.sum() };
    }
    return node;
  }
  private sum(): Node {
    let node = this.product();
    while (this.isOp("+", "-")) node = { t: "bin", op: (this.take() as { value: string }).value, a: node, b: this.product() };
    return node;
  }
  private product(): Node {
    let node = this.power();
    while (this.isOp("*", "/")) node = { t: "bin", op: (this.take() as { value: string }).value, a: node, b: this.power() };
    return node;
  }
  private power(): Node {
    let node = this.unary();
    while (this.isOp("^")) {
      this.take();
      node = { t: "bin", op: "^", a: node, b: this.unary() };
    }
    return node;
  }
  private unary(): Node {
    if (this.isOp("-", "+")) {
      const op = (this.take() as { value: string }).value;
      return { t: "unary", op, a: this.unary() };
    }
    return this.postfix();
  }
  private postfix(): Node {
    let node = this.primary();
    while (this.isOp("%")) {
      this.take();
      node = { t: "pct", a: node };
    }
    return node;
  }

  private primary(): Node {
    const token = this.take();
    if (token.kind === "num") return { t: "num", v: token.value };
    if (token.kind === "str") return { t: "str", v: token.value };
    if (token.kind === "lp") {
      const node = this.compare();
      if (this.take().kind !== "rp") throw new Error("Missing )");
      return node;
    }
    if (token.kind === "id") {
      const text = token.value;
      const upper = text.toUpperCase();
      if (text.startsWith("#")) return { t: "err", v: new XlError(upper) };
      if (this.peek().kind === "lp") return this.call(upper);
      if (upper === "TRUE") return { t: "bool", v: true };
      if (upper === "FALSE") return { t: "bool", v: false };
      return this.reference(text);
    }
    throw new Error("Unexpected token");
  }

  private reference(text: string): Node {
    const cell = parseAddr(text);
    if (cell && this.isOp(":")) {
      // A range such as B3:D9.
      this.take();
      const next = this.take();
      const end = next.kind === "id" ? parseAddr(next.value) : null;
      if (!end) throw new Error("Bad range");
      return { t: "range", c1: Math.min(cell.col, end.col), r1: Math.min(cell.row, end.row), c2: Math.max(cell.col, end.col), r2: Math.max(cell.row, end.row) };
    }
    if (cell) return { t: "ref", col: cell.col, row: cell.row };
    if (/^\$?[A-Za-z]{1,3}$/.test(text) && this.isOp(":")) {
      // Whole columns such as G:H.
      this.take();
      const next = this.take();
      if (next.kind === "id" && /^\$?[A-Za-z]{1,3}$/.test(next.value)) {
        const a = columnIndex(text.replace("$", ""));
        const b = columnIndex(next.value.replace("$", ""));
        return { t: "colrange", c1: Math.min(a, b), c2: Math.max(a, b) };
      }
      throw new Error("Bad range");
    }
    return { t: "name", name: text };
  }

  private call(name: string): Node {
    this.take(); // (
    const args: Node[] = [];
    if (this.peek().kind !== "rp") {
      args.push(this.argument());
      while (this.peek().kind === "comma") {
        this.take();
        args.push(this.argument());
      }
    }
    if (this.take().kind !== "rp") throw new Error("Missing )");
    return { t: "call", name, args };
  }

  /** An argument can be empty (IF(x,,y)); that reads as a blank. */
  private argument(): Node {
    const next = this.peek();
    if (next.kind === "comma" || next.kind === "rp") return { t: "err", v: new XlError("#EMPTY") };
    // A whole-column range such as G:H starts with a column name followed by ":".
    if (next.kind === "id" && /^\$?[A-Za-z]{1,3}$/.test(next.value) && !parseAddr(next.value)) {
      const after = this.tokens[this.index + 1];
      if (after?.kind === "op" && after.value === ":") {
        this.take();
        return this.reference(next.value);
      }
    }
    return this.compare();
  }
}

const parsed = new Map<string, Node>();

function parse(formula: string): Node {
  const cached = parsed.get(formula);
  if (cached) return cached;
  // Excel writes newer functions as _xlfn.LET and their names as _xlpm.name. Same formula without the prefixes.
  const node = new Parser(tokenize(formula.replace(/_xlfn\./g, "").replace(/_xlpm\./g, ""))).parse();
  parsed.set(formula, node);
  return node;
}

/* ---------------- values ---------------- */

function toNumber(value: Value): number | XlError {
  if (isError(value)) return value;
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  const text = value.trim();
  if (text === "") return VALUE;
  if (/^-?\d*\.?\d+(e[+-]?\d+)?%?$/i.test(text)) return text.endsWith("%") ? Number(text.slice(0, -1)) / 100 : Number(text);
  return VALUE;
}

function toText(value: Value): string | XlError {
  if (isError(value)) return value;
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return numberText(value);
  return value;
}

export function numberText(value: number): string {
  if (!Number.isFinite(value)) return "#NUM!";
  const rounded = Math.round(value * 1e12) / 1e12;
  return String(rounded);
}

function toBool(value: Value): boolean | XlError {
  if (isError(value)) return value;
  if (value == null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const upper = value.trim().toUpperCase();
  if (upper === "TRUE") return true;
  if (upper === "FALSE") return false;
  return VALUE;
}

/** Excel's ordering: numbers < text < booleans. Blank counts as 0 against a number, "" against text, FALSE against a boolean. */
function compareValues(a: Value, op: string, b: Value): Value {
  if (isError(a)) return a;
  if (isError(b)) return b;
  let left: number | string | boolean;
  let right: number | string | boolean;
  if (a == null && b == null) {
    left = 0;
    right = 0;
  } else if (a == null) {
    right = b as number | string | boolean;
    left = typeof right === "number" ? 0 : typeof right === "string" ? "" : false;
  } else if (b == null) {
    left = a;
    right = typeof left === "number" ? 0 : typeof left === "string" ? "" : false;
  } else {
    left = a;
    right = b;
  }
  const rank = (v: number | string | boolean) => (typeof v === "number" ? 0 : typeof v === "string" ? 1 : 2);
  let order: number;
  if (rank(left) !== rank(right)) order = rank(left) - rank(right);
  else if (typeof left === "string") {
    const l = left.toLowerCase();
    const r = (right as string).toLowerCase();
    order = l < r ? -1 : l > r ? 1 : 0;
  } else {
    const l = Number(left);
    const r = Number(right);
    order = l < r ? -1 : l > r ? 1 : 0;
  }
  switch (op) {
    case "=":
      return order === 0;
    case "<>":
      return order !== 0;
    case "<":
      return order < 0;
    case ">":
      return order > 0;
    case "<=":
      return order <= 0;
    default:
      return order >= 0;
  }
}

/* ---------------- evaluation ---------------- */

export interface EvalContext {
  /** The value of a cell. Called for every reference; the caller evaluates formula cells and keeps its own cycle guard. */
  cell: (col: number, row: number) => Value;
  /** The last row ranges such as G:H reach. */
  maxRow: number;
  functions?: Record<string, CustomFunction>;
}

type Scope = Map<string, FunctionArg>;

function scalar(arg: FunctionArg): Value {
  if (arg instanceof RangeValue) {
    const first = arg.rows[0]?.[0];
    return first === undefined ? VALUE : first;
  }
  return arg;
}

function evalNode(node: Node, ctx: EvalContext, scope: Scope): FunctionArg {
  switch (node.t) {
    case "num":
    case "str":
    case "bool":
    case "err":
      return node.t === "err" && node.v.code === "#EMPTY" ? null : node.v;
    case "ref":
      return ctx.cell(node.col, node.row);
    case "range": {
      const rows: Value[][] = [];
      for (let row = node.r1; row <= node.r2; row += 1) {
        const line: Value[] = [];
        for (let col = node.c1; col <= node.c2; col += 1) line.push(ctx.cell(col, row));
        rows.push(line);
      }
      return new RangeValue(rows);
    }
    case "colrange": {
      const rows: Value[][] = [];
      for (let row = 1; row <= ctx.maxRow; row += 1) {
        const line: Value[] = [];
        for (let col = node.c1; col <= node.c2; col += 1) line.push(ctx.cell(col, row));
        rows.push(line);
      }
      return new RangeValue(rows);
    }
    case "name": {
      const found = scope.get(node.name.toUpperCase());
      return found === undefined ? NAME : found;
    }
    case "unary": {
      const n = toNumber(scalar(evalNode(node.a, ctx, scope)));
      if (isError(n)) return n;
      return node.op === "-" ? -n : n;
    }
    case "pct": {
      const n = toNumber(scalar(evalNode(node.a, ctx, scope)));
      return isError(n) ? n : n / 100;
    }
    case "bin":
      return evalBinary(node, ctx, scope);
    case "call":
      return evalCall(node, ctx, scope);
  }
}

/** A range next to a single value, or two ranges, are worked cell by cell (an array formula), as Excel does. */
function evalBinary(node: Extract<Node, { t: "bin" }>, ctx: EvalContext, scope: Scope): FunctionArg {
  const left = evalNode(node.a, ctx, scope);
  const right = evalNode(node.b, ctx, scope);
  if (left instanceof RangeValue || right instanceof RangeValue) {
    const shape = left instanceof RangeValue ? left : (right as RangeValue);
    const pick = (side: FunctionArg, r: number, c: number): Value => (side instanceof RangeValue ? (side.rows[r]?.[c] === undefined ? NA : side.rows[r]![c]!) : side);
    return new RangeValue(shape.rows.map((line, r) => line.map((_, c) => applyBinary(node.op, pick(left, r, c), pick(right, r, c)))));
  }
  return applyBinary(node.op, left, right);
}

function applyBinary(op: string, a: Value, b: Value): Value {
  if (COMPARE.has(op)) return compareValues(a, op, b);
  if (op === "&") {
    const l = toText(a);
    const r = toText(b);
    if (isError(l)) return l;
    if (isError(r)) return r;
    return l + r;
  }
  const l = toNumber(a);
  const r = toNumber(b);
  if (isError(l)) return l;
  if (isError(r)) return r;
  switch (op) {
    case "+":
      return l + r;
    case "-":
      return l - r;
    case "*":
      return l * r;
    case "/":
      return r === 0 ? DIV0 : l / r;
    default: {
      const result = l ** r;
      return Number.isFinite(result) ? result : NUM;
    }
  }
}

/** Numbers found in the arguments, the way SUM and AVERAGE read them: text and blanks in ranges are skipped. */
function numbersIn(args: FunctionArg[]): number[] | XlError {
  const out: number[] = [];
  for (const arg of args) {
    if (arg instanceof RangeValue) {
      for (const value of arg.flat()) {
        if (isError(value)) return value;
        if (typeof value === "number") out.push(value);
      }
    } else {
      if (isError(arg)) return arg;
      if (arg == null) continue;
      const n = toNumber(arg);
      if (isError(n)) return n;
      out.push(n);
    }
  }
  return out;
}

function matchesCriteria(value: Value, criteria: Value): boolean {
  if (isError(criteria)) return false;
  let op = "=";
  let target: Value = criteria;
  if (typeof criteria === "string") {
    const match = /^(<=|>=|<>|=|<|>)(.*)$/.exec(criteria);
    if (match) {
      op = match[1]!;
      const rest = match[2]!;
      target = rest.trim() !== "" && !Number.isNaN(Number(rest)) ? Number(rest) : rest;
    } else if (criteria.trim() !== "" && !Number.isNaN(Number(criteria))) {
      target = Number(criteria);
    }
  }
  if (typeof target === "string" && /[*?]/.test(target) && (op === "=" || op === "<>")) {
    const pattern = new RegExp(`^${target.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
    const hit = typeof value === "string" && pattern.test(value);
    return op === "=" ? hit : !hit;
  }
  if (value == null) return op === "=" ? target === "" : op === "<>" ? target !== "" : false;
  // COUNTIF compares like with like: a number criterion matches numbers, a text criterion matches text.
  if (typeof target === "number" && typeof value !== "number") {
    if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value)) && op === "=") return Number(value) === target;
    return op === "<>";
  }
  if (typeof target === "string" && typeof value !== "string") return op === "<>";
  const result = compareValues(value, op, target);
  return result === true;
}

function regression(ys: number[], xs: number[]): { slope: number; intercept: number } | XlError {
  const n = ys.length;
  if (n !== xs.length || n === 0) return NA;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (xs[i]! - meanX) ** 2;
    sxy += (xs[i]! - meanX) * (ys[i]! - meanY);
  }
  if (sxx === 0) return DIV0;
  const slope = sxy / sxx;
  return { slope, intercept: meanY - slope * meanX };
}

/** Pairs of numbers from two ranges, dropping any pair where either side is not a number (as SLOPE and TREND do). */
function numberPairs(y: FunctionArg, x: FunctionArg): { ys: number[]; xs: number[] } | XlError {
  const ya = y instanceof RangeValue ? y.flat() : [y];
  const xa = x instanceof RangeValue ? x.flat() : [x];
  if (ya.length !== xa.length) return NA;
  const ys: number[] = [];
  const xs: number[] = [];
  for (let i = 0; i < ya.length; i += 1) {
    const yv = ya[i]!;
    const xv = xa[i]!;
    if (isError(yv)) return yv;
    if (isError(xv)) return xv;
    if (typeof yv === "number" && typeof xv === "number") {
      ys.push(yv);
      xs.push(xv);
    }
  }
  return { ys, xs };
}

function evalCall(node: Extract<Node, { t: "call" }>, ctx: EvalContext, scope: Scope): FunctionArg {
  const name = node.name;
  const lazy = (i: number) => evalNode(node.args[i]!, ctx, scope);
  const args = () => node.args.map((arg) => evalNode(arg, ctx, scope));

  if (name === "IF") {
    if (node.args.length < 2) return VALUE;
    const test = toBool(scalar(lazy(0)));
    if (isError(test)) return test;
    if (test) return lazy(1);
    return node.args.length > 2 ? lazy(2) : false;
  }
  if (name === "IFERROR") {
    const first = scalar(lazy(0));
    return isError(first) ? (node.args.length > 1 ? lazy(1) : null) : first;
  }
  if (name === "LET") {
    // LET(name1, value1, name2, value2, ..., calculation)
    const inner: Scope = new Map(scope);
    for (let i = 0; i + 1 < node.args.length; i += 2) {
      const nameNode = node.args[i]!;
      if (nameNode.t !== "name") return NAME;
      inner.set(nameNode.name.toUpperCase(), evalNode(node.args[i + 1]!, ctx, inner));
    }
    return evalNode(node.args[node.args.length - 1]!, ctx, inner);
  }

  const values = args();
  switch (name) {
    case "AND":
    case "OR": {
      let seen = false;
      let result = name === "AND";
      for (const arg of values) {
        const list = arg instanceof RangeValue ? arg.flat() : [arg];
        const fromRange = arg instanceof RangeValue;
        for (const value of list) {
          if (isError(value)) return value;
          if (value == null || (fromRange && typeof value === "string")) continue;
          const flag = toBool(value);
          if (isError(flag)) return flag;
          seen = true;
          if (name === "AND") result = result && flag;
          else result = result || flag;
        }
      }
      return seen ? result : VALUE;
    }
    case "NOT": {
      const flag = toBool(scalar(values[0] ?? null));
      return isError(flag) ? flag : !flag;
    }
    case "ABS": {
      const n = toNumber(scalar(values[0] ?? null));
      return isError(n) ? n : Math.abs(n);
    }
    case "SQRT": {
      const n = toNumber(scalar(values[0] ?? null));
      if (isError(n)) return n;
      return n < 0 ? NUM : Math.sqrt(n);
    }
    case "PI":
      return Math.PI;
    case "POWER": {
      const a = toNumber(scalar(values[0] ?? null));
      const b = toNumber(scalar(values[1] ?? null));
      if (isError(a)) return a;
      if (isError(b)) return b;
      const result = a ** b;
      return Number.isFinite(result) ? result : NUM;
    }
    case "ROUND": {
      const n = toNumber(scalar(values[0] ?? null));
      const digits = toNumber(scalar(values[1] ?? 0));
      if (isError(n)) return n;
      if (isError(digits)) return digits;
      const factor = 10 ** Math.trunc(digits);
      return Math.sign(n) * Math.round(Math.abs(n) * factor) / factor;
    }
    case "SUM":
    case "MIN":
    case "MAX":
    case "AVERAGE": {
      const nums = numbersIn(values);
      if (isError(nums)) return nums;
      if (name === "SUM") return nums.reduce((s, v) => s + v, 0);
      if (name === "AVERAGE") return nums.length === 0 ? DIV0 : nums.reduce((s, v) => s + v, 0) / nums.length;
      if (nums.length === 0) return 0;
      return name === "MIN" ? Math.min(...nums) : Math.max(...nums);
    }
    case "COUNT": {
      let count = 0;
      for (const arg of values) {
        if (arg instanceof RangeValue) count += arg.flat().filter((v) => typeof v === "number").length;
        else if (typeof arg === "number" || typeof arg === "boolean") count += 1;
        else if (typeof arg === "string" && arg.trim() !== "" && !Number.isNaN(Number(arg))) count += 1;
      }
      return count;
    }
    case "COUNTA": {
      let count = 0;
      for (const arg of values) {
        if (arg instanceof RangeValue) count += arg.flat().filter((v) => v != null && v !== "").length;
        else if (arg != null) count += 1;
      }
      return count;
    }
    case "COUNTIF": {
      const range = values[0];
      if (!(range instanceof RangeValue)) return VALUE;
      const criteria = scalar(values[1] ?? null);
      return range.flat().filter((value) => matchesCriteria(value, criteria)).length;
    }
    case "SEARCH": {
      const find = toText(scalar(values[0] ?? null));
      const within = toText(scalar(values[1] ?? null));
      if (isError(find)) return find;
      if (isError(within)) return within;
      const start = values[2] === undefined ? 1 : toNumber(scalar(values[2]));
      if (isError(start)) return start;
      const at = within.toLowerCase().indexOf(find.toLowerCase(), Math.max(0, start - 1));
      return at < 0 ? VALUE : at + 1;
    }
    case "ISERROR":
      return isError(scalar(values[0] ?? null));
    case "ISNUMBER":
      return typeof scalar(values[0] ?? null) === "number";
    case "ISBLANK":
      return scalar(values[0] ?? null) == null;
    case "LEN": {
      const text = toText(scalar(values[0] ?? null));
      return isError(text) ? text : text.length;
    }
    case "TRIM": {
      const text = toText(scalar(values[0] ?? null));
      return isError(text) ? text : text.trim().replace(/\s+/g, " ");
    }
    case "UPPER":
    case "LOWER": {
      const text = toText(scalar(values[0] ?? null));
      if (isError(text)) return text;
      return name === "UPPER" ? text.toUpperCase() : text.toLowerCase();
    }
    case "SLOPE": {
      const pairs = numberPairs(values[0] ?? null, values[1] ?? null);
      if (isError(pairs)) return pairs;
      const fit = regression(pairs.ys, pairs.xs);
      return isError(fit) ? fit : fit.slope;
    }
    case "TREND": {
      // TREND(known_y, known_x, new_x): the straight-line fit's value at new_x (the first one, in a single cell).
      const pairs = numberPairs(values[0] ?? null, values[1] ?? null);
      if (isError(pairs)) return pairs;
      const fit = regression(pairs.ys, pairs.xs);
      if (isError(fit)) return fit;
      const at = toNumber(scalar(values[2] ?? null));
      return isError(at) ? at : fit.intercept + fit.slope * at;
    }
    default: {
      const custom = ctx.functions?.[name];
      return custom ? custom(values) : NAME;
    }
  }
}

/** Evaluates formula text (without the leading =). Never throws; a formula that cannot be read is #NAME?. */
export function evaluateFormula(formula: string, ctx: EvalContext): Value {
  try {
    return scalar(evalNode(parse(formula), ctx, new Map()));
  } catch {
    return NAME;
  }
}

/** A cell value as it should be shown: numbers lose floating-point noise, TRUE/FALSE are upper case, errors show their code. */
export function showValue(value: Value | undefined): string {
  if (value == null) return "";
  if (isError(value)) return value.code;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return numberText(value);
  return value;
}

/** Turns text typed in a cell into the value a formula sees: numbers become numbers, TRUE and FALSE become booleans. */
export function parseTyped(raw: string): Value {
  const text = raw.trim();
  if (text === "") return null;
  if (/^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(text)) return Number(text);
  if (/^true$/i.test(text)) return true;
  if (/^false$/i.test(text)) return false;
  return raw;
}
