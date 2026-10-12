/** Limit-type calculations. Calculated limits are SAVED on result lines so history never changes. */

export type LimitType = "plus_minus" | "percent" | "min_max" | "attribute";

export interface CharSpec {
  limitType: LimitType;
  nominal?: string | null;
  tolerancePlus?: string | null;
  toleranceMinus?: string | null;
  percent?: string | null;
  specMin?: string | null;
  specMax?: string | null;
}

function num(s: string | null | undefined): number | null {
  if (s == null || s === "") return null;
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Returns [low, high] as strings, or [null, null] for attribute. */
export function calcLimits(spec: CharSpec): [string | null, string | null] {
  switch (spec.limitType) {
    case "plus_minus": {
      const n = num(spec.nominal);
      const p = num(spec.tolerancePlus);
      const m = num(spec.toleranceMinus);
      if (n == null || p == null || m == null) return [null, null];
      return [String(n - m), String(n + p)];
    }
    case "percent": {
      const n = num(spec.nominal);
      const pct = num(spec.percent);
      if (n == null || pct == null) return [null, null];
      const tol = Math.abs(n) * (pct / 100);
      return [String(n - tol), String(n + tol)];
    }
    case "min_max": {
      const lo = num(spec.specMin);
      const hi = num(spec.specMax);
      if (lo == null || hi == null) return [null, null];
      return [String(lo), String(hi)];
    }
    case "attribute":
      return [null, null];
  }
}

/** Auto PASS/FAIL of a measured value against saved limits. Null when it can't be judged. */
export function judgeLine(args: {
  limitType: LimitType;
  limitLow: string | null;
  limitHigh: string | null;
  measuredValue?: string | null;
  attributeResult?: string | null;
}): "pass" | "fail" | null {
  if (args.limitType === "attribute") {
    if (args.attributeResult === "pass") return "pass";
    if (args.attributeResult === "fail") return "fail";
    return null;
  }
  const v = num(args.measuredValue);
  const lo = num(args.limitLow);
  const hi = num(args.limitHigh);
  if (v == null || lo == null || hi == null) return null;
  return v >= lo && v <= hi ? "pass" : "fail";
}
