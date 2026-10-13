/**
 * Code 128 barcodes, made here so labels need no barcode library or font. Each pattern is the 11 bars and spaces
 * (1 = bar) of one symbol, in order: values 0 to 102 are the data symbols, then Start A, Start B and Start C. The
 * stop symbol is 13 modules with its last two bars. Checked against python-barcode and a real decoder (see code128.test.ts).
 *
 * Text is encoded in code set B (any printable ASCII, so letters, digits and hyphens as in FAI-0012-S03). Runs of four or
 * more digits are packed in code set C, which makes the barcode shorter, so it prints bigger on a small label.
 */
const PATTERNS: string[] = [
  "11011001100", "11001101100", "11001100110", "10010011000", "10010001100", "10001001100",
  "10011001000", "10011000100", "10001100100", "11001001000", "11001000100", "11000100100",
  "10110011100", "10011011100", "10011001110", "10111001100", "10011101100", "10011100110",
  "11001110010", "11001011100", "11001001110", "11011100100", "11001110100", "11101101110",
  "11101001100", "11100101100", "11100100110", "11101100100", "11100110100", "11100110010",
  "11011011000", "11011000110", "11000110110", "10100011000", "10001011000", "10001000110",
  "10110001000", "10001101000", "10001100010", "11010001000", "11000101000", "11000100010",
  "10110111000", "10110001110", "10001101110", "10111011000", "10111000110", "10001110110",
  "11101110110", "11010001110", "11000101110", "11011101000", "11011100010", "11011101110",
  "11101011000", "11101000110", "11100010110", "11101101000", "11101100010", "11100011010",
  "11101111010", "11001000010", "11110001010", "10100110000", "10100001100", "10010110000",
  "10010000110", "10000101100", "10000100110", "10110010000", "10110000100", "10011010000",
  "10011000010", "10000110100", "10000110010", "11000010010", "11001010000", "11110111010",
  "11000010100", "10001111010", "10100111100", "10010111100", "10010011110", "10111100100",
  "10011110100", "10011110010", "11110100100", "11110010100", "11110010010", "11011011110",
  "11011110110", "11110110110", "10101111000", "10100011110", "10001011110", "10111101000",
  "10111100010", "11110101000", "11110100010", "10111011110", "10111101110", "11101011110",
  "11110101110", "11010000100", "11010010000", "11010011100",
];

const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;
const STOP = "1100011101011";

function checksum(values: number[]): number {
  return values.reduce((total, value, index) => total + (index === 0 ? value : value * index), 0) % 103;
}

function digitRun(text: string, from: number): number {
  let n = 0;
  while (from + n < text.length && text[from + n]! >= "0" && text[from + n]! <= "9") n += 1;
  return n;
}

/** The symbol values for this text: start code, data (code set B or C), checksum. Throws for a character outside printable ASCII. */
export function code128Values(text: string): number[] {
  if (text.length === 0) throw new Error("Nothing to encode.");
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) throw new Error("A barcode can only hold plain letters, numbers and punctuation.");
  }
  const values: number[] = [];
  let set: "B" | "C" = "B";
  if (digitRun(text, 0) >= 4) {
    values.push(START_C);
    set = "C";
  } else {
    values.push(START_B);
  }
  let i = 0;
  while (i < text.length) {
    const run = digitRun(text, i);
    if (set === "C") {
      if (run >= 2) {
        values.push(Number(text.slice(i, i + 2)));
        i += 2;
      } else {
        values.push(CODE_B);
        set = "B";
      }
      continue;
    }
    if (run >= 4) {
      // An odd run keeps its first digit in set B, so the rest pairs up.
      if (run % 2 === 1) {
        values.push(text.charCodeAt(i) - 32);
        i += 1;
      }
      values.push(CODE_C);
      set = "C";
      continue;
    }
    values.push(text.charCodeAt(i) - 32);
    i += 1;
  }
  values.push(checksum(values));
  return values;
}

/** The barcode as modules: a string of 1 (bar) and 0 (space), quiet zone not included. */
export function code128Modules(text: string): string {
  return code128Values(text).map((value) => PATTERNS[value]!).join("") + STOP;
}

/** Bars as runs of modules, for drawing one rectangle per bar. */
export function code128Bars(text: string): { bars: { x: number; width: number }[]; modules: number } {
  const modules = code128Modules(text);
  const bars: { x: number; width: number }[] = [];
  let x = 0;
  while (x < modules.length) {
    if (modules[x] === "1") {
      let end = x;
      while (end < modules.length && modules[end] === "1") end += 1;
      bars.push({ x, width: end - x });
      x = end;
    } else {
      x += 1;
    }
  }
  return { bars, modules: modules.length };
}

/** Reads a barcode made by code128Modules back into text. For tests; null when the bars are not a valid Code 128. */
export function decodeCode128Modules(modules: string): string | null {
  if (!modules.endsWith(STOP)) return null;
  const body = modules.slice(0, -STOP.length);
  if (body.length % 11 !== 0) return null;
  const values: number[] = [];
  for (let i = 0; i < body.length; i += 11) {
    const value = PATTERNS.indexOf(body.slice(i, i + 11));
    if (value < 0) return null;
    values.push(value);
  }
  const check = values.pop();
  if (values.length === 0 || check !== checksum(values)) return null;
  let set: "B" | "C" | null = values[0] === START_B ? "B" : values[0] === START_C ? "C" : null;
  if (!set) return null;
  let out = "";
  for (const value of values.slice(1)) {
    if (set === "C") {
      if (value === CODE_B) set = "B";
      else if (value < 100) out += String(value).padStart(2, "0");
      else return null;
    } else if (value === CODE_C) {
      set = "C";
    } else if (value < 96) {
      out += String.fromCharCode(value + 32);
    } else {
      return null;
    }
  }
  return out;
}
