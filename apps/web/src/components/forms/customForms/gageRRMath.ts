/**
 * AIAG Gage R&R (Average and Range method) formulas, fixed to a 10-part x
 * 2-operator x 2-trial study — the exact configuration in the user-provided
 * "MSA Gauge R_R.pdf", whose worked example (D4=3.27, K1=0.8862, K2=0.7071,
 * K3=0.3146) this was checked against value-for-value. Supporting other
 * part/trial counts would need the rest of the AIAG constants table and is
 * out of scope.
 */

export const PART_COUNT = 10;
const D4 = 3.27; // 2 trials
const K1 = 0.8862; // 2 trials
const K2 = 0.7071; // 2 operators
const K3 = 0.3146; // 10 parts

export interface GageRRResult {
  meanA: number[];
  rangeA: number[];
  meanB: number[];
  rangeB: number[];
  partAvg: number[]; // Xśr p — per-part average of operator A & B means
  raBar: number;
  rbBar: number;
  rBar: number; // Rśr
  xBarDiff: number; // XśrDIFF
  uclR: number;
  ev: number;
  evPctTol: number | null;
  av: number;
  avPctTol: number | null;
  pv: number;
  pvPctTol: number | null;
  grr: number;
  grrPctTol: number | null;
  systemEvaluation: string;
}

function avg(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function at(values: number[], i: number): number {
  return values[i] ?? 0;
}

/** %GRR&Tol bands per the AIAG guideline (also what the reference document's own worked example — 18% — lands in). */
export function systemEvaluationFor(grrPct: number): string {
  if (grrPct < 10) return "Acceptable system";
  if (grrPct <= 30) return "Conditionally acceptable system";
  return "Unacceptable system — needs improvement";
}

/** trial1[i]/trial2[i] are the 10 part readings for one trial, for one operator. */
export function computeGageRR(
  aTrial1: number[],
  aTrial2: number[],
  bTrial1: number[],
  bTrial2: number[],
  tolerance: number
): GageRRResult {
  const n = PART_COUNT;
  const meanA = Array.from({ length: n }, (_, i) => (at(aTrial1, i) + at(aTrial2, i)) / 2);
  const rangeA = Array.from({ length: n }, (_, i) => Math.abs(at(aTrial1, i) - at(aTrial2, i)));
  const meanB = Array.from({ length: n }, (_, i) => (at(bTrial1, i) + at(bTrial2, i)) / 2);
  const rangeB = Array.from({ length: n }, (_, i) => Math.abs(at(bTrial1, i) - at(bTrial2, i)));

  const raBar = avg(rangeA);
  const rbBar = avg(rangeB);
  const rBar = (raBar + rbBar) / 2;

  const partAvg = Array.from({ length: n }, (_, i) => (at(meanA, i) + at(meanB, i)) / 2);

  const xBarDiff = Math.abs(avg(meanA) - avg(meanB));
  const uclR = rBar * D4;

  const ev = rBar * K1;
  const nr = n * 2; // parts x trials
  const avRaw = (xBarDiff * K2) ** 2 - ev ** 2 / nr;
  const av = avRaw > 0 ? Math.sqrt(avRaw) : 0;

  const rp = Math.max(...partAvg) - Math.min(...partAvg);
  const pv = rp * K3;

  const grr = Math.sqrt(ev ** 2 + av ** 2);

  const pctTol = (value: number) => (tolerance ? (100 * value) / tolerance : null);
  const grrPct = pctTol(grr);

  return {
    meanA,
    rangeA,
    meanB,
    rangeB,
    partAvg,
    raBar,
    rbBar,
    rBar,
    xBarDiff,
    uclR,
    ev,
    evPctTol: pctTol(ev),
    av,
    avPctTol: pctTol(av),
    pv,
    pvPctTol: pctTol(pv),
    grr,
    grrPctTol: grrPct,
    systemEvaluation: grrPct === null ? "" : systemEvaluationFor(grrPct),
  };
}
