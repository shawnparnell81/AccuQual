/**
 * ANSI/ASQ Z1.4 (ISO 2859-1) single-sampling tables, Normal inspection.
 * Code letters from Table 1, Ac/Re from Table 2-A.
 * Critical characteristics always use Ac 0 / Re 1 regardless of table.
 */

/** AQL values in column order. */
export const AQL_VALUES = [
  "0.010", "0.015", "0.025", "0.040", "0.065", "0.10", "0.15", "0.25",
  "0.40", "0.65", "1.0", "1.5", "2.5", "4.0", "6.5", "10.0",
] as const;
export type AqlValue = (typeof AQL_VALUES)[number];

export type InspectionLevel = "I" | "II" | "III" | "S-1" | "S-2" | "S-3" | "S-4";
export type InspectionSeverity = "Normal" | "Tightened" | "Reduced";

/** Lot-size ranges for Table 1. [min, max] inclusive. */
const LOT_RANGES: [number, number][] = [
  [2, 8], [9, 15], [16, 25], [26, 50], [51, 90], [91, 150], [151, 280],
  [281, 500], [501, 1200], [1201, 3200], [3201, 10000], [10001, 35000],
  [35001, 150000], [150001, 500000], [500001, Number.MAX_SAFE_INTEGER],
];

/** Table 1: code letter per lot-size range index, columns S-1 S-2 S-3 S-4 I II III. */
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
  ["A", "D", "E", "I", "N", "Q", "R"],
];

const LEVEL_COLUMNS: InspectionLevel[] = ["S-1", "S-2", "S-3", "S-4", "I", "II", "III"];

/** Sample size per code letter. */
export const SAMPLE_SIZES: Record<string, number> = {
  A: 2, B: 3, C: 5, D: 8, E: 13, F: 20, G: 32, H: 50,
  J: 80, K: 125, L: 200, M: 315, N: 500, P: 800, Q: 1250, R: 2000,
};

/**
 * Table 2-A (Normal inspection): [Ac, Re] per code letter, in AQL_VALUES order.
 * Values per ANSI/ASQ Z1.4.
 */
const NORMAL_TABLE: Record<string, [number, number][]> = {
  A: [[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1]],
  B: [[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1]],
  C: [[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[1,2],[2,3]],
  D: [[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[1,2],[1,2],[2,3],[2,3],[3,4],[5,6]],
  E: [[0,1],[0,1],[0,1],[0,1],[0,1],[1,2],[1,2],[1,2],[1,2],[1,2],[2,3],[3,4],[5,6],[5,6],[7,8],[10,11]],
  F: [[0,1],[0,1],[0,1],[0,1],[1,2],[1,2],[1,2],[2,3],[2,3],[3,4],[3,4],[5,6],[7,8],[10,11],[10,11],[14,15]],
  G: [[0,1],[0,1],[1,2],[1,2],[1,2],[2,3],[2,3],[3,4],[3,4],[5,6],[6,7],[8,9],[12,13],[18,19],[18,19],[21,22]],
  H: [[0,1],[1,2],[1,2],[2,3],[2,3],[3,4],[3,4],[5,6],[6,7],[8,9],[10,11],[14,15],[21,22],[21,22],[21,22],[21,22]],
  J: [[1,2],[1,2],[2,3],[2,3],[3,4],[3,4],[5,6],[6,7],[8,9],[10,11],[14,15],[21,22],[21,22],[21,22],[21,22],[21,22]],
  K: [[1,2],[2,3],[2,3],[3,4],[3,4],[5,6],[6,7],[8,9],[10,11],[14,15],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22]],
  L: [[2,3],[2,3],[3,4],[3,4],[5,6],[6,7],[8,9],[10,11],[14,15],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22]],
  M: [[2,3],[3,4],[3,4],[5,6],[6,7],[8,9],[10,11],[14,15],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22]],
  N: [[3,4],[3,4],[5,6],[6,7],[8,9],[10,11],[14,15],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22]],
  P: [[3,4],[5,6],[6,7],[8,9],[10,11],[14,15],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22]],
  Q: [[5,6],[6,7],[8,9],[10,11],[14,15],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22]],
  R: [[5,6],[8,9],[10,11],[14,15],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22],[21,22]],
};

export interface AqlLookup {
  codeLetter: string;
  sampleSize: number;
  ac: number;
  re: number;
}

/** Table 1 lookup: lot size + level -> code letter. */
export function codeLetterFor(lotSize: number, level: InspectionLevel): string {
  const rangeIdx = LOT_RANGES.findIndex(([min, max]) => lotSize >= min && lotSize <= max);
  const col = LEVEL_COLUMNS.indexOf(level);
  if (rangeIdx < 0 || col < 0) throw new Error(`Invalid lot size ${lotSize} or level ${level}`);
  return CODE_LETTERS[rangeIdx]![col]!;
}

/**
 * Full Z1.4 lookup. Critical characteristics always return Ac 0 / Re 1.
 * Tightened shifts one AQL column stricter; Reduced shifts one column more lenient.
 */
export function aqlLookup(
  lotSize: number,
  level: InspectionLevel,
  severity: InspectionSeverity,
  aql: string,
  isCritical = false,
): AqlLookup {
  if (isCritical) {
    const codeLetter = codeLetterFor(lotSize, level);
    return { codeLetter, sampleSize: SAMPLE_SIZES[codeLetter]!, ac: 0, re: 1 };
  }
  let aqlIdx = (AQL_VALUES as readonly string[]).indexOf(aql);
  if (aqlIdx < 0) throw new Error(`Unknown AQL value ${aql}`);
  if (severity === "Tightened") aqlIdx = Math.max(0, aqlIdx - 1);
  if (severity === "Reduced") aqlIdx = Math.min(AQL_VALUES.length - 1, aqlIdx + 1);
  const codeLetter = codeLetterFor(lotSize, level);
  const [ac, re] = NORMAL_TABLE[codeLetter]![aqlIdx]!;
  return { codeLetter, sampleSize: SAMPLE_SIZES[codeLetter]!, ac, re };
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
