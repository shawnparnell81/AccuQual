/**
 * Reads a spec typed as text into the range it allows. Pure: the same text always gives the same answer, and text that is not
 * a spec it recognises gives null, never a guess. A plain number with no tolerance ("243") is null too: it names a target
 * but no range, so nothing can be judged against it.
 *
 * Forms understood (spaces optional, decimals allowed, + and - written as + / -, ± or +-):
 *   "369 +/-2"       -> 367 to 371
 *   "18 +/- 0.2"     -> 17.8 to 18.2
 *   "195 +20/-10"    -> 185 to 215     ("195 -10/+20" reads the same)
 *   "185-215", "185 to 215", "min 185 max 215" -> 185 to 215
 */
export interface ToleranceRange {
  min: number;
  max: number;
}

const NUM = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;
const SIGNED = String.raw`-?${NUM}`;

const SYMMETRIC = new RegExp(String.raw`^(${SIGNED})\s*\+\s*/\s*-\s*(${NUM})$`);
const PLUS_MINUS = new RegExp(String.raw`^(${SIGNED})\s*\+\s*(${NUM})\s*/\s*-\s*(${NUM})$`);
const MINUS_PLUS = new RegExp(String.raw`^(${SIGNED})\s*-\s*(${NUM})\s*/\s*\+\s*(${NUM})$`);
const MIN_MAX_WORDS = new RegExp(String.raw`^min(?:imum)?\s*[:=]?\s*(${SIGNED})\s*[,;]?\s*max(?:imum)?\s*[:=]?\s*(${SIGNED})$`);
const TO_RANGE = new RegExp(String.raw`^(${SIGNED})\s*(?:to|\.\.)\s*(${SIGNED})$`);
const DASH_RANGE = new RegExp(String.raw`^(${NUM})\s*-\s*(${NUM})$`);

/** Floating-point noise removed: 18 - 0.2 is 17.8, not 17.799999999999997. */
function clean(value: number): number {
  return Math.round(value * 1e10) / 1e10;
}

function range(min: number, max: number): ToleranceRange | null {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return null;
  return { min: clean(min), max: clean(max) };
}

export function parseTolerance(input: unknown): ToleranceRange | null {
  if (typeof input !== "string") return null;
  const text = input
    .trim()
    .toLowerCase()
    .replace(/[−–—]/g, "-")
    .replace(/±/g, "+/-")
    .replace(/\+\s*-/g, "+/-")
    .replace(/\s+/g, " ");
  if (text === "") return null;

  let match = SYMMETRIC.exec(text);
  if (match) {
    const nominal = Number(match[1]);
    const tolerance = Number(match[2]);
    return range(nominal - tolerance, nominal + tolerance);
  }
  match = PLUS_MINUS.exec(text);
  if (match) {
    const nominal = Number(match[1]);
    return range(nominal - Number(match[3]), nominal + Number(match[2]));
  }
  match = MINUS_PLUS.exec(text);
  if (match) {
    const nominal = Number(match[1]);
    return range(nominal - Number(match[2]), nominal + Number(match[3]));
  }
  match = MIN_MAX_WORDS.exec(text) ?? TO_RANGE.exec(text) ?? DASH_RANGE.exec(text);
  if (match) return range(Number(match[1]), Number(match[2]));
  return null;
}

/** true when the measurement is inside the spec's range, false when outside, null when the spec or the measurement cannot be judged. */
export function withinSpec(spec: unknown, measured: unknown): boolean | null {
  const allowed = parseTolerance(spec);
  if (!allowed) return null;
  if (typeof measured !== "number" || !Number.isFinite(measured)) return null;
  // A hair of slack so a measurement of exactly 18.2 passes a limit that is 18.200000000000003 in binary.
  const slack = 1e-9;
  return measured >= allowed.min - slack && measured <= allowed.max + slack;
}
