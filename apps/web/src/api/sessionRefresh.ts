/**
 * One shared sign-in renewal for the whole tab.
 *
 * The access token is short-lived. When it runs out, every request that was
 * in flight fails at once. If each of those failures renewed the session on
 * its own, the server would see the same sign-in used twice and treat that
 * as theft — and a "slow down" response would be read as "signed out".
 * Callers share one in-flight renewal, wait for it, then replay their own
 * request. A slow-down waits and tries again. Only a real rejection ends
 * the session.
 */

export const PROACTIVE_REFRESH_LEAD_MS = 60_000;
/** Avoid renewing in a tight loop if a token is already inside the lead window. */
export const MIN_PROACTIVE_GAP_MS = 30_000;
const MAX_BACKOFF_MS = 15 * 60 * 1000;
/** Waits longer than this are left to the scheduler so open requests are not stuck. */
export const MAX_INLINE_BACKOFF_MS = 5_000;

export type RefreshAttempt =
  | { kind: "ok"; accessToken: string }
  | { kind: "unauthenticated" }
  | { kind: "backoff"; retryAfterMs: number };

export type RefreshResult =
  | { ok: true; accessToken: string }
  | { ok: false; logout: true }
  | { ok: false; logout: false; retryAfterMs: number };

export function createSessionRefresher(options: {
  /** `attempt` is how many failures already happened, so the wait can grow. */
  attempt: (attempt: number) => Promise<RefreshAttempt>;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}) {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxAttempts = options.maxAttempts ?? 4;
  let inFlight: Promise<RefreshResult> | null = null;

  async function run(): Promise<RefreshResult> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const outcome = await options.attempt(attempt);
      if (outcome.kind === "ok") return { ok: true, accessToken: outcome.accessToken };
      if (outcome.kind === "unauthenticated") return { ok: false, logout: true };
      if (outcome.retryAfterMs > MAX_INLINE_BACKOFF_MS || attempt === maxAttempts - 1) {
        return { ok: false, logout: false, retryAfterMs: outcome.retryAfterMs };
      }
      await sleep(outcome.retryAfterMs);
    }
    return { ok: false, logout: false, retryAfterMs: 1_000 };
  }

  return {
    /** Every caller awaits this same promise until the renewal in progress finishes. */
    refresh(): Promise<RefreshResult> {
      if (!inFlight) {
        inFlight = run().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
  };
}

/**
 * Wait for the shared renewal, then replay the request that failed.
 * Several callers queue on one renewal and each replay afterwards.
 */
export async function settleAfterRefresh<T>(
  refresh: () => Promise<RefreshResult>,
  replay: (accessToken: string) => Promise<T>,
  onLogout: () => void,
): Promise<{ ok: true; value: T } | { ok: false; logout: boolean }> {
  const result = await refresh();
  if (result.ok) return { ok: true, value: await replay(result.accessToken) };
  if (result.logout) onLogout();
  return { ok: false, logout: result.logout };
}

export function classifyRefreshFailure(status: number | undefined, retryAfterHeader: string | null | undefined, attempt: number, now = Date.now()): RefreshAttempt {
  // 401/403 (and any other refusal that is not "slow down") means the session
  // is really gone. 429, a dropped connection, and server errors do not.
  if (status !== 429 && status !== undefined && status < 500) return { kind: "unauthenticated" };
  return { kind: "backoff", retryAfterMs: retryDelayMs(attempt, retryAfterHeader, now) };
}

export function retryDelayMs(attempt: number, retryAfterHeader: string | null | undefined, now = Date.now()): number {
  const fromHeader = parseRetryAfterMs(retryAfterHeader, now);
  if (fromHeader != null) return Math.min(Math.max(fromHeader, 250), MAX_BACKOFF_MS);
  return Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** Math.max(0, attempt));
}

function parseRetryAfterMs(header: string | null | undefined, now: number): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return seconds * 1_000;
  const when = Date.parse(trimmed);
  if (Number.isFinite(when)) return when - now;
  return null;
}

/** Epoch milliseconds when this access token expires, or null if it cannot be read. The signature is not checked — the server does that. */
export function accessTokenExpiresAtMs(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(decodeBase64Url(payload)) as { exp?: unknown };
    if (typeof json.exp !== "number" || !Number.isFinite(json.exp)) return null;
    return json.exp * 1_000;
  } catch {
    return null;
  }
}

/** How long to wait before renewing. Zero means the token is already inside the lead window (or already expired). */
export function proactiveRefreshDelayMs(token: string, now = Date.now(), leadMs = PROACTIVE_REFRESH_LEAD_MS): number | null {
  const expiresAt = accessTokenExpiresAtMs(token);
  if (expiresAt == null) return null;
  return Math.max(0, expiresAt - leadMs - now);
}

/**
 * Same as the delay above, except a token that is already due does not schedule
 * another immediate renewal when one just happened.
 */
export function nextProactiveDelayMs(token: string, now: number, lastRefreshAt: number, leadMs = PROACTIVE_REFRESH_LEAD_MS, minGapMs = MIN_PROACTIVE_GAP_MS): number | null {
  const delay = proactiveRefreshDelayMs(token, now, leadMs);
  if (delay == null) return null;
  if (delay > 0) return delay;
  if (lastRefreshAt > 0) {
    const since = now - lastRefreshAt;
    if (since < minGapMs) return minGapMs - since;
  }
  return 0;
}

function decodeBase64Url(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (input.length % 4)) % 4);
  if (typeof atob === "function") return atob(padded);
  return Buffer.from(padded, "base64").toString("utf8");
}
