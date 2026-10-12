/** Pure random-pick math, separated out so it's testable without a database. */

export interface PickRulesInput {
  pickMode: "percent" | "count";
  pickPercent: number | null;
  pickCount: number | null;
}

/** How many of `poolSize` eligible sources to pick, per the rules. Never more than the pool. */
export function pickTarget(rules: PickRulesInput, poolSize: number): number {
  if (poolSize <= 0) return 0;
  if (rules.pickMode === "count") {
    return Math.max(0, Math.min(rules.pickCount ?? 0, poolSize));
  }
  const pct = Math.max(0, Math.min(100, rules.pickPercent ?? 0));
  if (pct <= 0) return 0;
  // At least 1 if the rule asks for any nonzero percent and the pool isn't empty — a
  // rounded-to-zero percent on a small pool should not silently pick nothing.
  return Math.max(1, Math.min(poolSize, Math.round((pct / 100) * poolSize)));
}

/**
 * Unbiased sample of `count` ids from `ids`, no replacement — Fisher-Yates partial
 * shuffle. `rng` defaults to Math.random; tests pass a seeded one for determinism.
 */
export function randomSample<T>(ids: readonly T[], count: number, rng: () => number = Math.random): T[] {
  const pool = [...ids];
  const n = Math.max(0, Math.min(count, pool.length));
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, n);
}
