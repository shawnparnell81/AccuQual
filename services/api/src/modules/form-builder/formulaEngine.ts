/**
 * Formula engine for grid forms. The web grid and the API use this one module, so a filled copy shows the same
 * results on screen, in the saved record and on the PDF.
 *
 * A formula is read by a tokenizer and a parser into a small tree and then evaluated by walking that tree.
 * Nothing is ever run as code: there is no eval, no Function constructor and no property lookup by name,
 * so text such as "constructor" or "__proto__" is only ever a name that is not known (#NAME?).
 *
 * Supported: numbers, "text", TRUE/FALSE, + - * / ^ %, unary minus, & (join text), = <> < > <= >=,
 * parentheses, A1 and $A$1 references, A1:B5 ranges, and SUM, AVERAGE, MIN, MAX, IF, ROUND, COUNT, ABS,
 * AND, OR, NOT. Function names are not case sensitive.
 *
 * Errors stay in the cell: #REF! (bad reference), #DIV/0!, #VALUE! (text in math, or a formula that cannot be
 * read), #NAME? (unknown function or name), #CIRC! (circular reference), #NUM! (number out of range, or the
 * evaluation limit was reached).
 */

export type FormulaValue = string | number | boolean | null;

export const ERR_DIV0 = "#DIV/0!";
export const ERR_VALUE = "#VALUE!";
export const ERR_REF = "#REF!";
export const ERR_NAME = "#NAME?";
export const ERR_CIRC = "#CIRC!";
export const ERR_NUM = "#NUM!";

const ERRORS: ReadonlySet<string> = new Set([ERR_DIV0, ERR_VALUE, ERR_REF, ERR_NAME, ERR_CIRC, ERR_NUM]);

/** Limits that keep one formula, or one sheet, from tying up the browser or the server. */
export const MAX_FORMULA_LENGTH = 2000;
export const MAX_NESTING = 50;
export const MAX_RANGE_CELLS = 30_000;
export const MAX_STEPS = 1_000_000;
/** The largest column (XFD) and row a reference can name, as in Excel. */
const MAX_COL = 16_384;
const MAX_ROW = 1_048_576;

export const FUNCTIONS: readonly string[] = ["SUM", "AVERAGE", "MIN", "MAX", "IF", "ROUND", "COUNT", "ABS", "AND", "OR", "NOT"];
const KNOWN = new Set(FUNCTIONS);

export function isFormulaError(value: unknown): boolean {
  return typeof value === "string" && ERRORS.has(value);
}

// ---------------------------------------------------------------- references

export interface CellRef {
  col: number;
  row: number;
  absCol: boolean;
  absRow: boolean;
}

export function columnNumber(letters: string): number {
  let col = 0;
  for (const ch of letters.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return col;
}

export function columnName(index: number): string {
  let n = index;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

const REF_TEXT = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/;

export function parseRef(text: string): CellRef | null {
  const match = REF_TEXT.exec(text);
  if (!match) return null;
  const col = columnNumber(match[2]!);
  const row = Number(match[4]);
  if (col < 1 || col > MAX_COL || row < 1 || row > MAX_ROW) return null;
  return { col, row, absCol: match[1] === "$", absRow: match[3] === "$" };
}

export function refText(ref: CellRef): string {
  return `${ref.absCol ? "$" : ""}${columnName(ref.col)}${ref.absRow ? "$" : ""}${ref.row}`;
}

export function cellAddress(col: number, row: number): string {
  return `${columnName(col)}${row}`;
}

// ---------------------------------------------------------------- tokens

type TokenKind = "num" | "str" | "name" | "error" | "op" | "lp" | "rp" | "comma" | "colon" | "eof";

interface Token {
  kind: TokenKind;
  text: string;
  at: number;
}

export class FormulaSyntaxError extends Error {}

function fail(message: string): never {
  throw new FormulaSyntaxError(message);
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    const at = i;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "(") tokens.push({ kind: "lp", text: ch, at });
    else if (ch === ")") tokens.push({ kind: "rp", text: ch, at });
    else if (ch === ",") tokens.push({ kind: "comma", text: ch, at });
    else if (ch === ":") tokens.push({ kind: "colon", text: ch, at });
    if ("(),:".includes(ch)) {
      i += 1;
      continue;
    }
    if (ch === '"') {
      let text = "";
      i += 1;
      let closed = false;
      while (i < source.length) {
        if (source[i] === '"') {
          if (source[i + 1] === '"') {
            text += '"';
            i += 2;
            continue;
          }
          i += 1;
          closed = true;
          break;
        }
        text += source[i];
        i += 1;
      }
      if (!closed) fail("A text value is missing its closing quote.");
      tokens.push({ kind: "str", text, at });
      continue;
    }
    if (ch === "#") {
      const known = [...ERRORS].find((error) => source.slice(i, i + error.length).toUpperCase() === error);
      if (!known) fail(`"${source.slice(i, i + 8)}" is not a known value.`);
      tokens.push({ kind: "error", text: known, at });
      i += known.length;
      continue;
    }
    const two = source.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      tokens.push({ kind: "op", text: two, at });
      i += 2;
      continue;
    }
    if ("+-*/^=<>&%".includes(ch)) {
      tokens.push({ kind: "op", text: ch, at });
      i += 1;
      continue;
    }
    if ((ch >= "0" && ch <= "9") || ch === ".") {
      const match = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(source.slice(i));
      if (!match) fail(`"${ch}" is not a number.`);
      tokens.push({ kind: "num", text: match[0], at });
      i += match[0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const match = /^[A-Za-z_$][A-Za-z0-9_$.]*/.exec(source.slice(i))!;
      tokens.push({ kind: "name", text: match[0], at });
      i += match[0].length;
      continue;
    }
    fail(`"${ch}" cannot be used in a formula.`);
  }
  tokens.push({ kind: "eof", text: "", at: source.length });
  return tokens;
}

// ---------------------------------------------------------------- tree

export type Node =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "err"; v: string }
  | { t: "ref"; ref: CellRef }
  | { t: "range"; a: CellRef; b: CellRef }
  | { t: "name"; name: string }
  | { t: "neg"; x: Node }
  | { t: "pct"; x: Node }
  | { t: "bin"; op: string; l: Node; r: Node }
  | { t: "call"; name: string; args: Node[] };

class Parser {
  private index = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.index]!;
  }

  private take(): Token {
    const token = this.tokens[this.index]!;
    if (token.kind !== "eof") this.index += 1;
    return token;
  }

  private isOp(...ops: string[]): boolean {
    const token = this.peek();
    return token.kind === "op" && ops.includes(token.text);
  }

  private nest<T>(read: () => T): T {
    this.depth += 1;
    if (this.depth > MAX_NESTING) fail(`The formula is nested more than ${MAX_NESTING} levels deep.`);
    try {
      return read();
    } finally {
      this.depth -= 1;
    }
  }

  parse(): Node {
    if (this.peek().kind === "eof") fail("The formula is empty.");
    const node = this.compare();
    const rest = this.peek();
    if (rest.kind !== "eof") fail(rest.kind === "rp" ? "There is a ) without a matching (." : `"${rest.text}" is not expected there.`);
    return node;
  }

  private compare(): Node {
    let left = this.concat();
    while (this.isOp("=", "<>", "<", ">", "<=", ">=")) {
      const op = this.take().text;
      left = { t: "bin", op, l: left, r: this.concat() };
    }
    return left;
  }

  private concat(): Node {
    let left = this.sum();
    while (this.isOp("&")) {
      this.take();
      left = { t: "bin", op: "&", l: left, r: this.sum() };
    }
    return left;
  }

  private sum(): Node {
    let left = this.product();
    while (this.isOp("+", "-")) {
      const op = this.take().text;
      left = { t: "bin", op, l: left, r: this.product() };
    }
    return left;
  }

  private product(): Node {
    let left = this.power();
    while (this.isOp("*", "/")) {
      const op = this.take().text;
      left = { t: "bin", op, l: left, r: this.power() };
    }
    return left;
  }

  /** As in Excel, ^ reads left to right and a leading minus binds tighter: -2^2 is 4. */
  private power(): Node {
    let left = this.unary();
    while (this.isOp("^")) {
      this.take();
      left = { t: "bin", op: "^", l: left, r: this.unary() };
    }
    return left;
  }

  private unary(): Node {
    if (this.isOp("-", "+")) {
      const op = this.take().text;
      return this.nest(() => {
        const x = this.unary();
        return op === "-" ? { t: "neg", x } : x;
      });
    }
    return this.percent();
  }

  private percent(): Node {
    let node = this.primary();
    while (this.isOp("%")) {
      this.take();
      node = { t: "pct", x: node };
    }
    return node;
  }

  private primary(): Node {
    const token = this.take();
    switch (token.kind) {
      case "num": {
        const v = Number(token.text);
        if (!Number.isFinite(v)) fail(`${token.text} is too large.`);
        return { t: "num", v };
      }
      case "str":
        return { t: "str", v: token.text };
      case "error":
        return { t: "err", v: token.text };
      case "lp": {
        const inner = this.nest(() => this.compare());
        if (this.peek().kind !== "rp") fail("A ( is missing its closing ).");
        this.take();
        return inner;
      }
      case "name":
        return this.name(token);
      case "eof":
        return fail("The formula ends too soon.");
      default:
        return fail(`"${token.text}" is not expected there.`);
    }
  }

  private name(token: Token): Node {
    const upper = token.text.toUpperCase();
    if (this.peek().kind === "lp") {
      this.take();
      return this.nest(() => this.call(upper));
    }
    if (upper === "TRUE") return { t: "bool", v: true };
    if (upper === "FALSE") return { t: "bool", v: false };
    const ref = parseRef(token.text);
    if (!ref) return { t: "name", name: token.text };
    if (this.peek().kind === "colon") {
      this.take();
      const end = this.take();
      const b = end.kind === "name" ? parseRef(end.text) : null;
      if (!b) fail(`A range must end with a cell, such as ${token.text}:${columnName(ref.col)}${ref.row + 4}.`);
      return { t: "range", a: ref, b };
    }
    return { t: "ref", ref };
  }

  private call(name: string): Node {
    const args: Node[] = [];
    if (this.peek().kind !== "rp") {
      args.push(this.compare());
      while (this.peek().kind === "comma") {
        this.take();
        args.push(this.compare());
      }
    }
    if (this.peek().kind !== "rp") fail(`${name}( is missing its closing ).`);
    this.take();
    return { t: "call", name, args };
  }
}

/** Reads a formula (with or without its leading =). Throws FormulaSyntaxError with a plain message. */
export function parseFormula(source: string): Node {
  const body = source.replace(/^\s*=/, "");
  if (body.length > MAX_FORMULA_LENGTH) fail(`The formula is longer than ${MAX_FORMULA_LENGTH} characters.`);
  return new Parser(tokenize(body)).parse();
}

function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  if (node.t === "neg" || node.t === "pct") walk(node.x, visit);
  else if (node.t === "bin") {
    walk(node.l, visit);
    walk(node.r, visit);
  } else if (node.t === "call") node.args.forEach((arg) => walk(arg, visit));
}

const ARITY: Record<string, [number, number]> = {
  IF: [2, 3],
  ROUND: [1, 2],
  ABS: [1, 1],
  NOT: [1, 1],
};

/**
 * The problem with a formula in plain words, or null when it can be saved. Unknown functions are named, so a
 * layout is never saved with a formula that would only ever show #NAME?.
 */
export function formulaProblem(source: string): string | null {
  let tree: Node;
  try {
    tree = parseFormula(source);
  } catch (error) {
    if (error instanceof FormulaSyntaxError) return error.message;
    throw error;
  }
  let problem: string | null = null;
  walk(tree, (node) => {
    if (problem) return;
    if (node.t === "call") {
      if (!KNOWN.has(node.name)) {
        problem = `${node.name} is not a function this form can calculate. Use ${FUNCTIONS.join(", ")}.`;
        return;
      }
      const arity = ARITY[node.name];
      if (arity && (node.args.length < arity[0] || node.args.length > arity[1])) {
        problem = arity[0] === arity[1] ? `${node.name} takes ${arity[0]} value${arity[0] === 1 ? "" : "s"}.` : `${node.name} takes ${arity[0]} to ${arity[1]} values.`;
        return;
      }
      if ((node.name === "SUM" || node.name === "AVERAGE" || node.name === "MIN" || node.name === "MAX" || node.name === "COUNT" || node.name === "AND" || node.name === "OR") && node.args.length === 0) {
        problem = `${node.name} needs at least one value.`;
      }
    } else if (node.t === "name") {
      problem = `${node.name} is not a cell or a known value. Put text in quotes, such as "${node.name}".`;
    } else if (node.t === "range") {
      const size = (Math.abs(node.a.col - node.b.col) + 1) * (Math.abs(node.a.row - node.b.row) + 1);
      if (size > MAX_RANGE_CELLS) problem = `The range ${refText(node.a)}:${refText(node.b)} has more than ${MAX_RANGE_CELLS.toLocaleString("en-US")} cells.`;
    }
  });
  return problem;
}

// ---------------------------------------------------------------- evaluation

/** Cell text by address (A1). A value starting with = is a formula. Anything else is a typed value. */
export type CellInputs = Record<string, string>;

export interface EvaluateOptions {
  /** The sheet size. A reference outside it is #REF!. */
  rows?: number;
  cols?: number;
}

class LimitReached extends Error {}

class Evaluator {
  private readonly cells = new Map<string, string>();
  private readonly trees = new Map<string, Node | string>();
  private readonly cache = new Map<string, FormulaValue>();
  private readonly active = new Set<string>();
  private steps = 0;

  constructor(
    inputs: CellInputs,
    private readonly options: EvaluateOptions,
  ) {
    for (const [key, raw] of Object.entries(inputs)) {
      if (typeof raw === "string") this.cells.set(key.toUpperCase(), raw);
    }
  }

  private step() {
    this.steps += 1;
    if (this.steps > MAX_STEPS) throw new LimitReached();
  }

  private outside(col: number, row: number): boolean {
    const { rows, cols } = this.options;
    return (rows != null && row > rows) || (cols != null && col > cols);
  }

  value(key: string): FormulaValue {
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    if (this.active.has(key)) return ERR_CIRC;
    const raw = this.cells.get(key);
    let result: FormulaValue;
    if (raw == null || raw === "") result = null;
    else if (raw.startsWith("=")) {
      this.active.add(key);
      try {
        result = this.formula(key, raw);
      } finally {
        this.active.delete(key);
      }
      // A cell inside a loop shows #CIRC! too, not only the one that closed it.
      if (result === ERR_CIRC) this.cache.set(key, ERR_CIRC);
    } else result = literal(raw);
    this.cache.set(key, result);
    return result;
  }

  private formula(key: string, raw: string): FormulaValue {
    let tree = this.trees.get(key);
    if (tree === undefined) {
      const problem = formulaProblem(raw);
      if (problem) tree = /not a function|not a cell or a known value/.test(problem) ? ERR_NAME : /^The range /.test(problem) ? ERR_REF : ERR_VALUE;
      else tree = parseFormula(raw);
      this.trees.set(key, tree);
    }
    if (typeof tree === "string") return tree;
    const value = this.eval(tree);
    if (typeof value === "number" && !Number.isFinite(value)) return ERR_NUM;
    return value;
  }

  private ref(ref: CellRef): FormulaValue {
    if (this.outside(ref.col, ref.row)) return ERR_REF;
    return this.value(cellAddress(ref.col, ref.row));
  }

  private range(a: CellRef, b: CellRef): FormulaValue[] | string {
    const c1 = Math.min(a.col, b.col);
    const c2 = Math.max(a.col, b.col);
    const r1 = Math.min(a.row, b.row);
    const r2 = Math.max(a.row, b.row);
    if ((c2 - c1 + 1) * (r2 - r1 + 1) > MAX_RANGE_CELLS) return ERR_REF;
    if (this.outside(c2, r2)) return ERR_REF;
    const values: FormulaValue[] = [];
    for (let row = r1; row <= r2; row += 1) {
      for (let col = c1; col <= c2; col += 1) {
        this.step();
        values.push(this.value(cellAddress(col, row)));
      }
    }
    return values;
  }

  eval(node: Node): FormulaValue {
    this.step();
    switch (node.t) {
      case "num":
      case "str":
      case "bool":
        return node.v;
      case "err":
        return node.v;
      case "name":
        return ERR_NAME;
      case "ref":
        return this.ref(node.ref);
      case "range": {
        // A range on its own (not inside a function) gives its only cell, or #VALUE! for more than one.
        const values = this.range(node.a, node.b);
        if (typeof values === "string") return values;
        return values.length === 1 ? values[0]! : ERR_VALUE;
      }
      case "neg": {
        const x = this.eval(node.x);
        if (isFormulaError(x)) return x;
        const n = toNumber(x);
        return n == null ? ERR_VALUE : -n;
      }
      case "pct": {
        const x = this.eval(node.x);
        if (isFormulaError(x)) return x;
        const n = toNumber(x);
        return n == null ? ERR_VALUE : n / 100;
      }
      case "bin":
        return this.binary(node.op, this.eval(node.l), this.eval(node.r));
      case "call":
        return this.call(node.name, node.args);
    }
  }

  private binary(op: string, left: FormulaValue, right: FormulaValue): FormulaValue {
    if (isFormulaError(left)) return left;
    if (isFormulaError(right)) return right;
    if (op === "&") return show(left) + show(right);
    if (op === "=" || op === "<>" || op === "<" || op === ">" || op === "<=" || op === ">=") return compare(left, op, right);
    const a = toNumber(left);
    const b = toNumber(right);
    if (a == null || b == null) return ERR_VALUE;
    let result: number;
    if (op === "+") result = a + b;
    else if (op === "-") result = a - b;
    else if (op === "*") result = a * b;
    else if (op === "/") {
      if (b === 0) return ERR_DIV0;
      result = a / b;
    } else {
      if (a === 0 && b < 0) return ERR_DIV0;
      result = a ** b;
    }
    return Number.isFinite(result) ? result : ERR_NUM;
  }

  /** Each argument as a list: a range gives every cell (blank ones as null), anything else gives itself. */
  private lists(args: Node[]): Array<{ values: FormulaValue[]; fromRange: boolean }> | string {
    const out: Array<{ values: FormulaValue[]; fromRange: boolean }> = [];
    for (const arg of args) {
      if (arg.t === "range") {
        const values = this.range(arg.a, arg.b);
        if (typeof values === "string") return values;
        out.push({ values, fromRange: true });
      } else out.push({ values: [this.eval(arg)], fromRange: arg.t === "ref" });
    }
    return out;
  }

  private call(name: string, args: Node[]): FormulaValue {
    if (!KNOWN.has(name)) return ERR_NAME;
    const arity = ARITY[name];
    if (arity && (args.length < arity[0] || args.length > arity[1])) return ERR_VALUE;

    if (name === "IF") {
      const test = this.eval(args[0]!);
      if (isFormulaError(test)) return test;
      const flag = truthy(test);
      if (typeof flag === "string") return flag;
      if (flag) return blankAsZero(this.eval(args[1]!));
      return args.length > 2 ? blankAsZero(this.eval(args[2]!)) : false;
    }
    if (name === "ROUND") {
      const first = this.eval(args[0]!);
      if (isFormulaError(first)) return first;
      const digitsValue = args.length > 1 ? this.eval(args[1]!) : 0;
      if (isFormulaError(digitsValue)) return digitsValue;
      const n = toNumber(first);
      const digits = toNumber(digitsValue);
      if (n == null || digits == null) return ERR_VALUE;
      return roundHalfAway(n, Math.trunc(digits));
    }
    if (name === "ABS") {
      const x = this.eval(args[0]!);
      if (isFormulaError(x)) return x;
      const n = toNumber(x);
      return n == null ? ERR_VALUE : Math.abs(n);
    }
    if (name === "NOT") {
      const x = this.eval(args[0]!);
      if (isFormulaError(x)) return x;
      const flag = truthy(x);
      return typeof flag === "string" ? flag : !flag;
    }
    if (args.length === 0) return ERR_VALUE;
    const lists = this.lists(args);
    if (typeof lists === "string") return lists;

    if (name === "AND" || name === "OR") {
      let seen = false;
      let result = name === "AND";
      for (const { values, fromRange } of lists) {
        for (const value of values) {
          if (isFormulaError(value)) return value;
          if (value == null) continue;
          if (typeof value === "string" && fromRange) continue;
          const flag = truthy(value);
          if (typeof flag === "string") return flag;
          seen = true;
          result = name === "AND" ? result && flag : result || flag;
        }
      }
      return seen ? result : ERR_VALUE;
    }

    // SUM, AVERAGE, MIN, MAX, COUNT. Cells in a range that are blank or hold text are skipped, as in Excel.
    // A value typed straight into the call is counted when it reads as a number and is #VALUE! when not.
    const nums: number[] = [];
    for (const { values, fromRange } of lists) {
      for (const value of values) {
        if (isFormulaError(value)) {
          if (name === "COUNT") continue;
          return value;
        }
        if (value == null) continue;
        if (fromRange) {
          if (typeof value === "number") nums.push(value);
          continue;
        }
        const n = toNumber(value);
        if (n == null) {
          if (name === "COUNT") continue;
          return ERR_VALUE;
        }
        nums.push(n);
      }
    }
    if (name === "COUNT") return nums.length;
    if (name === "SUM") return nums.reduce((total, n) => total + n, 0);
    if (nums.length === 0) return name === "AVERAGE" ? ERR_DIV0 : 0;
    if (name === "AVERAGE") return nums.reduce((total, n) => total + n, 0) / nums.length;
    let best = nums[0]!;
    for (const n of nums) best = name === "MIN" ? Math.min(best, n) : Math.max(best, n);
    return best;
  }
}

function blankAsZero(value: FormulaValue): FormulaValue {
  return value == null ? 0 : value;
}

function roundHalfAway(n: number, places: number): FormulaValue {
  if (Math.abs(places) > 15) return ERR_NUM;
  const factor = 10 ** Math.abs(places);
  const sign = n < 0 ? -1 : 1;
  const abs = Math.abs(n);
  // The small nudge keeps 1.005 rounding to 1.01, the way Excel shows it.
  const scaled = places >= 0 ? Math.round(abs * factor * (1 + Number.EPSILON)) / factor : Math.round(abs / factor) * factor;
  return sign * scaled;
}

/** Typed text as a value: numbers (including 12% and 1,250.5) become numbers, TRUE/FALSE become logicals. */
export function literal(raw: string): FormulaValue {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (/^[+-]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed) || /^[+-]?\.\d+$/.test(trimmed)) return Number(trimmed.replace(/,/g, ""));
  if (/^[+-]?\d+(\.\d+)?%$/.test(trimmed)) return Number(trimmed.slice(0, -1)) / 100;
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === "true";
  return raw;
}

function toNumber(value: FormulaValue): number | null {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (isFormulaError(value)) return null;
  const parsed = literal(value);
  return typeof parsed === "number" ? parsed : null;
}

function truthy(value: FormulaValue): boolean | string {
  if (value == null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (isFormulaError(value)) return value;
  const upper = value.trim().toUpperCase();
  if (upper === "TRUE") return true;
  if (upper === "FALSE") return false;
  return ERR_VALUE;
}

function show(value: FormulaValue): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return displayValue(value);
  return value;
}

function compare(left: FormulaValue, op: string, right: FormulaValue): boolean {
  const rank = (value: FormulaValue) => (typeof value === "number" || value == null ? 0 : typeof value === "string" ? 1 : 2);
  let order: number;
  const l = left ?? (typeof right === "string" ? "" : typeof right === "boolean" ? false : 0);
  const r = right ?? (typeof left === "string" ? "" : typeof left === "boolean" ? false : 0);
  if (rank(l) !== rank(r)) order = rank(l) - rank(r);
  else if (typeof l === "string" && typeof r === "string") {
    const a = l.toLowerCase();
    const b = r.toLowerCase();
    order = a < b ? -1 : a > b ? 1 : 0;
  } else {
    const a = Number(l);
    const b = Number(r);
    order = a < b ? -1 : a > b ? 1 : 0;
  }
  if (op === "=") return order === 0;
  if (op === "<>") return order !== 0;
  if (op === "<") return order < 0;
  if (op === ">") return order > 0;
  if (op === "<=") return order <= 0;
  return order >= 0;
}

/**
 * Every cell's value. Formulas are calculated; typed values come back as numbers, logicals or text;
 * blank cells are left out. Reaching the evaluation limit leaves #NUM! in the formula cells.
 */
export function evaluateGrid(inputs: CellInputs, options: EvaluateOptions = {}): Record<string, FormulaValue> {
  const evaluator = new Evaluator(inputs, options);
  const out: Record<string, FormulaValue> = {};
  let limited = false;
  // A pass from the last cell back resolves long chains that point down or right a step at a time,
  // so the main pass does not have to follow them all in one go.
  const entries = Object.entries(inputs);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const [key, raw] = entries[index]!;
    if (typeof raw !== "string" || !raw.startsWith("=")) continue;
    try {
      evaluator.value(key.toUpperCase());
    } catch (error) {
      if (!(error instanceof LimitReached) && !(error instanceof RangeError)) throw error;
      break;
    }
  }
  for (const [key, raw] of entries) {
    if (typeof raw !== "string" || raw === "") continue;
    const address = key.toUpperCase();
    if (limited && raw.startsWith("=")) {
      out[address] = ERR_NUM;
      continue;
    }
    try {
      out[address] = evaluator.value(address);
    } catch (error) {
      // A very long chain of references can run out of stack; it is treated like the step limit.
      if (!(error instanceof LimitReached) && !(error instanceof RangeError)) throw error;
      limited = true;
      out[address] = ERR_NUM;
    }
  }
  return out;
}

/** A value as the cell shows it. `decimals` sets how a number is shown; the stored value is not rounded. */
export function displayValue(value: FormulaValue | undefined, decimals?: number): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return ERR_NUM;
    if (decimals != null && decimals >= 0 && decimals <= 15) {
      const shown = roundHalfAway(value, decimals);
      return typeof shown === "number" ? shown.toFixed(decimals) : String(shown);
    }
    return String(Math.round(value * 1e10) / 1e10);
  }
  return value;
}

// ---------------------------------------------------------------- rewriting after rows or columns move

export type GridChange = { axis: "row" | "col"; kind: "insert"; at: number; count: number } | { axis: "row" | "col"; kind: "delete"; from: number; to: number };

/** Where a 1-based row or column ends up after the change, or null when it was deleted. */
function moved(index: number, change: GridChange): number | null {
  if (change.kind === "insert") return index >= change.at ? index + change.count : index;
  if (index < change.from) return index;
  if (index > change.to) return index - (change.to - change.from + 1);
  return null;
}

function moveRef(ref: CellRef, change: GridChange): CellRef | null {
  const index = change.axis === "row" ? ref.row : ref.col;
  const next = moved(index, change);
  if (next == null) return null;
  return change.axis === "row" ? { ...ref, row: next } : { ...ref, col: next };
}

/** A range keeps the rows or columns that are left; it is #REF! only when every one of them was deleted. */
function moveRange(a: CellRef, b: CellRef, change: GridChange): [CellRef, CellRef] | null {
  const key = change.axis === "row" ? "row" : "col";
  const [lo, hi] = a[key] <= b[key] ? [a, b] : [b, a];
  if (change.kind === "insert") return [moveRef(lo, change)!, moveRef(hi, change)!];
  const start = lo[key] >= change.from && lo[key] <= change.to ? change.to + 1 : lo[key];
  const end = hi[key] >= change.from && hi[key] <= change.to ? change.from - 1 : hi[key];
  if (start > end) return null;
  return [moveRef({ ...lo, [key]: start }, change)!, moveRef({ ...hi, [key]: end }, change)!];
}

/**
 * The formula with its references updated for rows or columns inserted or deleted (1-based numbers, as in A1).
 * A reference to a deleted cell becomes #REF!. Text inside quotes is never touched. A formula that cannot be
 * read is returned as it was.
 */
export function rewriteFormula(source: string, change: GridChange): string {
  const hadEquals = /^\s*=/.test(source);
  const body = source.replace(/^\s*=/, "");
  let tokens: Token[];
  try {
    tokens = tokenize(body);
  } catch {
    return source;
  }
  let out = "";
  let last = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token.kind !== "name" || tokens[i + 1]?.kind === "lp") continue;
    const a = parseRef(token.text);
    if (!a) continue;
    let replacement: string;
    let end = token.at + token.text.length;
    if (tokens[i + 1]?.kind === "colon" && tokens[i + 2]?.kind === "name" && parseRef(tokens[i + 2]!.text)) {
      const b = parseRef(tokens[i + 2]!.text)!;
      const range = moveRange(a, b, change);
      replacement = range ? `${refText(range[0])}:${refText(range[1])}` : ERR_REF;
      end = tokens[i + 2]!.at + tokens[i + 2]!.text.length;
      i += 2;
    } else {
      const next = moveRef(a, change);
      replacement = next ? refText(next) : ERR_REF;
    }
    out += body.slice(last, token.at) + replacement;
    last = end;
  }
  out += body.slice(last);
  return hadEquals ? `=${out}` : out;
}
