/**
 * In-process rolling counters behind the alert rules. Deliberately small and dependency-free: the API runs as one
 * long-lived process (see healthMonitor.ts's note on why), so process memory is the right store for "how many 5xx in
 * the last five minutes". A restart resets them, which is fine — an alert about a burst that ended before a
 * restart has nothing left to say.
 */
export class RollingCounter {
  private readonly buckets = new Map<number, number>();
  constructor(
    private readonly windowMs: number,
    private readonly bucketMs = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  add(n = 1): void {
    const key = Math.floor(this.now() / this.bucketMs);
    this.buckets.set(key, (this.buckets.get(key) ?? 0) + n);
    this.prune();
  }

  /** Total within the last `windowMs` (or a shorter `withinMs`). */
  total(withinMs: number = this.windowMs): number {
    const oldest = Math.floor((this.now() - Math.min(withinMs, this.windowMs)) / this.bucketMs);
    let sum = 0;
    for (const [key, count] of this.buckets) if (key >= oldest) sum += count;
    return sum;
  }

  private prune(): void {
    const oldest = Math.floor((this.now() - this.windowMs) / this.bucketMs);
    for (const key of this.buckets.keys()) if (key < oldest) this.buckets.delete(key);
  }

  reset(): void {
    this.buckets.clear();
  }
}

const FIFTEEN_MIN = 15 * 60_000;

/** Everything the alert rules read. One shared instance; tests may call reset(). */
export const metrics = {
  requests: new RollingCounter(FIFTEEN_MIN),
  serverErrors: new RollingCounter(FIFTEEN_MIN),
  loginFailures: new RollingCounter(FIFTEEN_MIN),
  lockouts: new RollingCounter(FIFTEEN_MIN),
  emailFailures: new RollingCounter(FIFTEEN_MIN),

  recordRequest(status: number): void {
    this.requests.add();
    if (status >= 500) this.serverErrors.add();
  },
  reset(): void {
    for (const c of [this.requests, this.serverErrors, this.loginFailures, this.lockouts, this.emailFailures]) c.reset();
  },
};
