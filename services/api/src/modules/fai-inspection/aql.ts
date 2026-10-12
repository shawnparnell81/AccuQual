/**
 * ANSI/ASQ Z1.4 (ISO 2859-1) single-sampling tables.
 * Table I: code letters. Tables II-A (Normal), II-B (Tightened), II-C (Reduced).
 * Arrow cells ("up"/"down") resolve to the first sampling plan in that direction,
 * using that plan's Ac/Re AND its sample size.
 * Critical characteristics always use Ac 0 / Re 1 regardless of table.
 */

export const AQL_VALUES = [
  "0.010", "0.015", "0.025", "0.040", "0.065", "0.10", "0.15", "0.25",
  "0.40", "0.65", "1.0", "1.5", "2.5", "4.0", "6.5", "10.0",
] as const;
export type AqlValue = (typeof AQL_VALUES)[number];

export type InspectionLevel = "I" | "II" | "III" | "S-1" | "S-2" | "S-3" | "S-4";
export type InspectionSeverity = "Normal" | "Tightened" | "Reduced";

type Cell = [number, number] | "up" | "down";

/** Table I lot-size ranges: [min, max] inclusive. */
const LOT_RANGES: [number, number][] = [
  [2, 8], [9, 15], [16, 25], [26, 50], [51, 90], [91, 150], [151, 280],
  [281, 500], [501, 1200], [1201, 3200], [3201, 10000], [10001, 35000],
  [35001, 150000], [150001, 500000], [500001, Number.MAX_SAFE_INTEGER],
];

/** Table I: code letter per range, columns S-1 S-2 S-3 S-4 I II III. No letter "I" is used. */
const CODE_LETTERS: string[][] = [
  ["A", "A", "A", "A", "A", "A", "A"],
  ["A", "A", "A", "A", "A", "B", "C"],
  ["A", "A", "B", "B", "B", "C", "D"],
  ["A", "B", "B", "C", "C", "D", "E"],
  ["A", "B", "C", "C", "C", "E", "F"],
  ["A", "B", "C", "D", "D", "F", "G"],
  ["A", "B", "D", "E", "E", "G", "H"],
  ["A", "C", "D", "E", "F", "H", "J"],
  ["A", "C", "D", "E", "G", "J", "K"],
  ["A", "C", "E", "F", "H", "K", "L"],
  ["A", "C", "E", "G", "J", "L", "M"],
  ["A", "C", "E", "G", "K", "M", "N"],
  ["A", "D", "E", "H", "L", "N", "P"],
  ["A", "D", "E", "H", "M", "P", "Q"],
  ["D", "E", "H", "K", "N", "Q", "R"],
];

const LEVEL_COLUMNS: InspectionLevel[] = ["S-1", "S-2", "S-3", "S-4", "I", "II", "III"];

/** Sample size per code letter. */
export const SAMPLE_SIZES: Record<string, number> = {
  A: 2, B: 3, C: 5, D: 8, E: 13, F: 20, G: 32, H: 50,
  J: 80, K: 125, L: 200, M: 315, N: 500, P: 800, Q: 1250, R: 2000,
};

/** Code letters in table order (for arrow resolution). */
const CODE_ORDER = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "Q", "R"];

/**
 * Table II-A (Normal). Cells in AQL_VALUES order.
 * "down" = use first plan below (larger n); "up" = use first plan above (smaller n).
 */
const TABLE_NORMAL: Record<string, Cell[]> = {
  A: [[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1]],
  B: [[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1]],
  C: [[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[1,2],[2,3]],
  D: [[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[1,2],[1,2],[2,3],[2,3],[3,4],[5,6]],
  E: [[0,1],[0,1],[0,1],[0,1],[0,1],[1,2],[1,2],[1,2],[1,2],[1,2],[2,3],[3,4],[5,6],[5,6],[7,8],[10,11]],
  F: [[0,1],[0,1],[0,1],[0,1],[1,2],[1,2],[1,2],[2,3],[2,3],[3,4],[3,4],[5,6],[7,8],[10,11],[10,11],[14,15]],
  G: [[0,1],[0,1],[1,2],[1,2],[1,2],[2,3],[2,3],[3,4],[3,4],[5,6],[6,7],[8,9],[12,13],[18,19],[18,19],[21,22]],
  H: [[0,1],[0,1],[0,1],[1,2],[1,2],[1,2],[2,3],[2,3],[3,4],"down",[1,2],[2,3],[3,4],[5,6],[7,8],[10,11]],
  J: [[0,1],[0,1],[1,2],[1,2],[2,3],[2,3],[3,4],[3,4],[5,6],[1,2],[2,3],[3,4],[5,6],[7,8],[10,11],[14,15]],
  K: [[0,1],[1,2],[1,2],[2,3],[2,3],[3,4],[3,4],[5,6],[6,7],[2,3],[3,4],[5,6],[7,8],[10,11],[14,15],[21,22]],
  L: [[1,2],[1,2],[2,3],[2,3],[3,4],[3,4],[5,6],[6,7],[8,9],[3,4],[5,6],[7,8],[10,11],[14,15],[21,22],[21,22]],
  M: [[1,2],[2,3],[2,3],[3,4],[3,4],[5,6],[6,7],[8,9],[10,11],[5,6],[7,8],[10,11],[14,15],[21,22],[21,22],[21,22]],
  N: [[2,3],[2,3],[3,4],[3,4],[5,6],[5,6],[7,8],[8,9],[10,11],[7,8],[10,11],[14,15],[21,22],[21,22],[21,22],[21,22]],
  P: [[2,3],[3,4],[3,4],[5,6],[5,6],[7,8],[8,9],[10,11],[14,15],[10,11],[14,15],[21,22],[21,22],[21,22],[21,22],[21,22]],
  Q: [[3,4],[3,4],[5,6],[5,6],[7,8],[8,9],[10,11],[14,15],[21,22],[14,15],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22]],
  R: [[3,4],[5,6],[5,6],[7,8],[8,9],[10,11],[14,15],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22]],
};

/**
 * Table II-B (Tightened). Same structure; generally one AQL column stricter than Normal.
 */
const TABLE_TIGHTENED: Record<string, Cell[]> = {
  A: [[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1]],
  B: [[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[1,2]],
  C: [[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[1,2],[1,2],[2,3]],
  D: [[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[1,2],[1,2],[1,2],[2,3],[2,3],[3,4],[3,4]],
  E: [[0,1],[0,1],[0,1],[0,1],[1,2],[1,2],[1,2],[1,2],[1,2],[1,2],[2,3],[2,3],[3,4],[5,6],[5,6],[7,8]],
  F: [[0,1],[0,1],[0,1],[1,2],[1,2],[1,2],[1,2],[2,3],[2,3],[2,3],[3,4],[3,4],[5,6],[5,6],[7,8],[10,11]],
  G: [[0,1],[0,1],[1,2],[1,2],[1,2],[2,3],[2,3],[2,3],[3,4],[3,4],[5,6],[5,6],[7,8],[8,9],[10,11],[14,15]],
  H: [[0,1],[0,1],[0,1],[1,2],[1,2],[1,2],[1,2],[2,3],[2,3],[2,3],[1,2],[2,3],[3,4],[5,6],[5,6],[7,8]],
  J: [[1,2],[1,2],[1,2],[2,3],[2,3],[2,3],[3,4],[3,4],[5,6],[5,6],[7,8],[8,9],[10,11],[14,15],[14,15],[21,22]],
  K: [[1,2],[1,2],[2,3],[2,3],[2,3],[3,4],[3,4],[5,6],[5,6],[7,8],[8,9],[10,11],[14,15],[14,15],[21,22],[21,22]],
  L: [[1,2],[2,3],[2,3],[2,3],[3,4],[3,4],[5,6],[5,6],[7,8],[8,9],[10,11],[14,15],[14,15],[21,22],[21,22],[21,22]],
  M: [[2,3],[2,3],[2,3],[3,4],[3,4],[5,6],[5,6],[7,8],[8,9],[10,11],[14,15],[14,15],[21,22],[21,22],[21,22],[21,22]],
  N: [[2,3],[2,3],[3,4],[3,4],[5,6],[5,6],[7,8],[8,9],[10,11],[14,15],[14,15],[21,22],[21,22],[21,22],[21,22],[21,22]],
  P: [[2,3],[3,4],[3,4],[5,6],[5,6],[7,8],[8,9],[10,11],[14,15],[14,15],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22]],
  Q: [[3,4],[3,4],[5,6],[5,6],[7,8],[8,9],[10,11],[14,15],[14,15],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22]],
  R: [[3,4],[5,6],[5,6],[7,8],[8,9],[10,11],[14,15],[14,15],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22]],
};

/**
 * Table II-C (Reduced). Same structure; generally more lenient than Normal.
 */
const TABLE_REDUCED: Record<string, Cell[]> = {
  A: [[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[1,2],[2,3]],
  B: [[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[1,2],[1,2],[2,3],[3,4]],
  C: [[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[1,2],[1,2],[2,3],[2,3],[3,4],[5,6]],
  D: [[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[1,2],[1,2],[2,3],[2,3],[3,4],[3,4],[5,6],[7,8]],
  E: [[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[1,2],[1,2],[2,3],[2,3],[3,4],[5,6],[5,6],[7,8],[7,8],[10,11]],
  F: [[0,1],[0,1],[0,1],[0,1],[0,1],[1,2],[1,2],[2,3],[3,4],[3,4],[5,6],[5,6],[7,8],[10,11],[10,11],[14,15]],
  G: [[0,1],[0,1],[0,1],[0,1],[1,2],[1,2],[2,3],[3,4],[3,4],[5,6],[6,7],[8,9],[10,11],[14,15],[14,15],[18,19]],
  H: [[0,1],[0,1],[0,1],[1,2],[1,2],[2,3],[2,3],[3,4],[5,6],[5,6],[7,8],[8,9],[12,13],[14,15],[18,19],[21,22]],
  J: [[0,1],[0,1],[1,2],[1,2],[2,3],[2,3],[3,4],[5,6],[5,6],[7,8],[8,9],[12,13],[14,15],[18,19],[21,22],[21,22]],
  K: [[0,1],[1,2],[1,2],[2,3],[2,3],[3,4],[5,6],[5,6],[7,8],[8,9],[12,13],[14,15],[18,19],[21,22],[21,22],[21,22]],
  L: [[1,2],[1,2],[2,3],[2,3],[3,4],[5,6],[5,6],[7,8],[8,9],[12,13],[14,15],[18,19],[21,22],[21,22],[21,22],[21,22]],
  M: [[1,2],[2,3],[2,3],[3,4],[5,6],[5,6],[7,8],[8,9],[12,13],[14,15],[18,19],[21,22],[21,22],[21,22],[21,22],[21,22]],
  N: [[2,3],[2,3],[3,4],[5,6],[5,6],[7,8],[8,9],[12,13],[14,15],[18,19],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22]],
  P: [[2,3],[3,4],[5,6],[5,6],[7,8],[8,9],[12,13],[14,15],[18,19],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22]],
  Q: [[3,4],[5,6],[5,6],[7,8],[8,9],[12,13],[14,15],[18,19],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22]],
  R: [[3,4],[5,6],[7,8],[8,9],[12,13],[14,15],[18,19],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22]],
};

const TABLES: Record<InspectionSeverity, Record<string, Cell[]>> = {
  Normal: TABLE_NORMAL,
  Tightened: TABLE_TIGHTENED,
  Reduced: TABLE_REDUCED,
};

export interface AqlLookup {
  codeLetter: string;
  sampleSize: number;
  ac: number;
  re: number;
}

/** Table I lookup: lot size + level -> code letter. */
export function codeLetterFor(lotSize: number, level: InspectionLevel): string {
  const rangeIdx = LOT_RANGES.findIndex(([min, max]) => lotSize >= min && lotSize <= max);
  const col = LEVEL_COLUMNS.indexOf(level);
  if (rangeIdx < 0 || col < 0) throw new Error(`Invalid lot size ${lotSize} or level ${level}`);
  return CODE_LETTERS[rangeIdx]![col]!;
}

/** Resolve a cell, following arrows. Returns [codeLetter, ac, re]. */
function resolveCell(table: Record<string, Cell[]>, code: string, aqlIdx: number): [string, number, number] {
  const orderIdx = CODE_ORDER.indexOf(code);
  const cell = table[code]![aqlIdx]!;
  if (cell === "down") {
    for (let i = orderIdx + 1; i < CODE_ORDER.length; i++) {
      const c = table[CODE_ORDER[i]!]![aqlIdx]!;
      if (c !== "down" && c !== "up") return [CODE_ORDER[i]!, c[0], c[1]];
    }
    throw new Error(`No sampling plan below ${code} for AQL index ${aqlIdx}`);
  }
  if (cell === "up") {
    for (let i = orderIdx - 1; i >= 0; i--) {
      const c = table[CODE_ORDER[i]!]![aqlIdx]!;
      if (c !== "down" && c !== "up") return [CODE_ORDER[i]!, c[0], c[1]];
    }
    throw new Error(`No sampling plan above ${code} for AQL index ${aqlIdx}`);
  }
  return [code, cell[0], cell[1]];
}

/**
 * Full Z1.4 lookup with arrow handling.
 * Critical characteristics always return Ac 0 / Re 1.
 */
export function aqlLookup(
  lotSize: number,
  level: InspectionLevel,
  severity: InspectionSeverity,
  aql: string,
  isCritical = false,
): AqlLookup {
  const codeLetter = codeLetterFor(lotSize, level);
  if (isCritical) {
    return { codeLetter, sampleSize: SAMPLE_SIZES[codeLetter]!, ac: 0, re: 1 };
  }
  const aqlIdx = (AQL_VALUES as readonly string[]).indexOf(aql);
  if (aqlIdx < 0) throw new Error(`Unknown AQL value ${aql}`);
  const table = TABLES[severity];
  const [resolvedCode, ac, re] = resolveCell(table, codeLetter, aqlIdx);
  return { codeLetter: resolvedCode, sampleSize: SAMPLE_SIZES[resolvedCode]!, ac, re };
}

/** Lot result: fail if any class defects reach its Re, or any critical defect. */
export function lotResult(args: {
  criticalDefects: number;
  majorDefects: number;
  minorDefects: number;
  reMajor: number;
  reMinor: number;
}): "pass" | "fail" {
  if (args.criticalDefects > 0) return "fail";
  if (args.majorDefects >= args.reMajor) return "fail";
  if (args.minorDefects >= args.reMinor) return "fail";
  return "pass";
}
