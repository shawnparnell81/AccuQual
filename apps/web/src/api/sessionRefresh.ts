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
/** Extra wait, as a fraction of the floor, so tabs do not retry on the same instant. */
const JITTER_FRACTION = 0.25;
/** Cross-tab claim. A crashed tab stops holding it after this. */
export const REFRESH_LOCK_KEY = "accuqual-refresh-lock";
export const REFRESH_LOCK_TTL_MS = 20_000;

export type RefreshAttempt =
  | { kind: "ok"; accessToken: string }
  | { kind: "unauthenticated" }
  | { kind: "backoff"; retryAfterMs: number };

export type RefreshResult =
  | { ok: true; accessToken: string }
  | { ok: false; logout: true }
  | { ok: false; logout: false; retryAfterMs: number };

export function createSessionRefresher(options: {
  /**
   * One try. The attempt number is how many failures already happened, so the
   * wait can grow across scheduled retries. A slow-down is not tried again
   * inside this call — that loop was spending the renewal budget.
   */
  attempt: (attempt: number) => Promise<RefreshAttempt>;
}) {
  let inFlight: Promise<RefreshResult> | null = null;

  async function run(): Promise<RefreshResult> {
    const outcome = await options.attempt(0);
    if (outcome.kind === "ok") return { ok: true, accessToken: outcome.accessToken };
    if (outcome.kind === "unauthenticated") return { ok: false, logout: true };
    return { ok: false, logout: false, retryAfterMs: outcome.retryAfterMs };
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

/**
 * Only a 401 from the refresh call means the server refused the session
 * (expired, revoked, or no cookie). A 403, a 429, a 5xx, or a dropped
 * connection leaves the cookie alone, so the page stays put and the call is
 * tried again.
 */
export function classifyRefreshFailure(status: number | undefined, retryAfterHeader: string | null | undefined, attempt: number, now = Date.now(), random: () => number = Math.random): RefreshAttempt {
  if (status === 401) return { kind: "unauthenticated" };
  return { kind: "backoff", retryAfterMs: retryDelayMs(attempt, retryAfterHeader, now, random) };
}

/**
 * How long to wait before the next renewal.
 * Retry-After is the earliest time. Without it, the wait doubles each failure.
 * Jitter is added on top, never subtracted, so a 429 is not retried early and
 * several tabs do not line up on the same second.
 */
export function retryDelayMs(attempt: number, retryAfterHeader: string | null | undefined, now = Date.now(), random: () => number = Math.random): number {
  const exponential = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** Math.max(0, attempt));
  const fromHeader = parseRetryAfterMs(retryAfterHeader, now);
  const floor = fromHeader != null ? Math.min(Math.max(fromHeader, 250), MAX_BACKOFF_MS) : exponential;
  const spread = Math.min(Math.max(0, MAX_BACKOFF_MS - floor), Math.floor(floor * JITTER_FRACTION));
  const unit = Math.min(1, Math.max(0, random()));
  return floor + Math.floor(spread * unit);
}

/** Axios hides Retry-After behind `.get`. A number or a one-item list still counts. */
export function readRetryAfterHeader(headers: unknown): string | null {
  if (!headers || typeof headers !== "object") return null;
  const bag = headers as { get?: (name: string) => unknown };
  const fromGet = typeof bag.get === "function" ? bag.get("retry-after") : undefined;
  const record = headers as Record<string, unknown>;
  const raw = fromGet ?? record["retry-after"] ?? record["Retry-After"];
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "string" && raw.trim()) return raw;
  if (Array.isArray(raw)) {
    const first = raw.find((item) => typeof item === "string" || typeof item === "number");
    if (typeof first === "number" && Number.isFinite(first)) return String(first);
    if (typeof first === "string" && first.trim()) return first;
  }
  return null;
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

export type RefreshReason = "proactive" | "bootstrap" | "unauthorized";

/**
 * The load-time session check has finished.
 * "ready" is a renewed session. "signed-out" is a 401: the server said the
 * session is expired or revoked. "retry" is a 429, a 5xx, or a dropped
 * connection — the cookie may still be valid, so the app stays on the page.
 */
export function bootstrapSessionDecision(result: RefreshResult): "ready" | "signed-out" | "retry" {
  if (result.ok) return "ready";
  if (result.logout) return "signed-out";
  return "retry";
}

/** A missing page or a missing record is not a dropped session. */
export function routeNotFoundTriggersReconnect(status: number | undefined): boolean {
  if (status === 404) return false;
  return false;
}

/**
 * The reconnect screen is only for a known page whose session is still coming back.
 * An address this app does not have shows the 404 page instead.
 */
export function showSessionReconnect(input: { reconnecting: boolean; accessToken: string | null; knownPath: boolean }): boolean {
  if (input.accessToken) return false;
  if (!input.reconnecting) return false;
  return input.knownPath;
}

/** The sign-in page is only for a session the server refused. A retry stays on the current page. */
export function shouldRedirectToLogin(input: { accessToken: string | null; reconnecting: boolean }): boolean {
  if (input.accessToken) return false;
  if (input.reconnecting) return false;
  return true;
}

export interface StoredRefreshLock {
  owner: string;
  expiresAt: number;
}

export function parseRefreshLock(raw: string | null): StoredRefreshLock | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { owner?: unknown; expiresAt?: unknown };
    if (typeof parsed.owner !== "string" || parsed.owner.length === 0) return null;
    if (typeof parsed.expiresAt !== "number" || !Number.isFinite(parsed.expiresAt)) return null;
    return { owner: parsed.owner, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

/** Take the cross-tab claim, or report how long the other tab still holds it. */
export function refreshLockClaim(input: { now: number; ownerId: string; existing: StoredRefreshLock | null; ttlMs?: number }): { acquired: true; lock: StoredRefreshLock } | { acquired: false; retryAfterMs: number } {
  const ttlMs = input.ttlMs ?? REFRESH_LOCK_TTL_MS;
  if (input.existing && input.existing.owner !== input.ownerId && input.existing.expiresAt > input.now) {
    return { acquired: false, retryAfterMs: Math.max(50, input.existing.expiresAt - input.now) };
  }
  return { acquired: true, lock: { owner: input.ownerId, expiresAt: input.now + ttlMs } };
}

export interface RefreshLockStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * One renewal across tabs. A second tab waits, and if `peek` already has the
 * leader's result it does not call `work`. A lock older than the deadline is
 * abandoned so a crashed tab cannot block sign-in forever.
 */
export async function runWithRefreshLock<T>(options: {
  storage: RefreshLockStorage;
  ownerId: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  ttlMs?: number;
  maxWaitMs?: number;
  peek?: () => T | null;
  work: () => Promise<T>;
}): Promise<T> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const ttlMs = options.ttlMs ?? REFRESH_LOCK_TTL_MS;
  const deadline = now() + (options.maxWaitMs ?? ttlMs);

  while (true) {
    const peeked = options.peek?.() ?? null;
    if (peeked != null) return peeked;
    const existing = parseRefreshLock(options.storage.getItem(REFRESH_LOCK_KEY));
    const claim = refreshLockClaim({ now: now(), ownerId: options.ownerId, existing, ttlMs });
    if (!claim.acquired) {
      if (now() >= deadline) return options.work();
      await sleep(Math.min(claim.retryAfterMs, 250));
      continue;
    }
    options.storage.setItem(REFRESH_LOCK_KEY, JSON.stringify(claim.lock));
    const confirmed = parseRefreshLock(options.storage.getItem(REFRESH_LOCK_KEY));
    if (confirmed?.owner !== options.ownerId) {
      if (now() >= deadline) return options.work();
      await sleep(20);
      continue;
    }
    try {
      return await options.work();
    } finally {
      const current = parseRefreshLock(options.storage.getItem(REFRESH_LOCK_KEY));
      if (current?.owner === options.ownerId) options.storage.removeItem(REFRESH_LOCK_KEY);
    }
  }
}

/** While a renewal is waiting out a 429 or a server error, another caller must not start a new one. */
export function refreshWhileBackingOff(now: number, retryNotBefore: number): { ok: false; logout: false; retryAfterMs: number } | null {
  const waitMs = retryNotBefore - now;
  if (waitMs <= 0) return null;
  return { ok: false, logout: false, retryAfterMs: waitMs };
}

/** True when there is no readable expiry, or the access token is inside the lead window (including already expired). */
export function tokenNearExpiry(token: string | null, now = Date.now(), leadMs = PROACTIVE_REFRESH_LEAD_MS): boolean {
  if (!token) return true;
  const expiresAt = accessTokenExpiresAtMs(token);
  if (expiresAt == null) return true;
  return expiresAt - now <= leadMs;
}

/**
 * Whether this caller should hit the network.
 * A still-valid access token does not need a renewal, including when some other request returned 401.
 * A renewal that just succeeded is not repeated until the gap has passed.
 */
export function refreshDecision(input: { reason: RefreshReason; accessToken: string | null; now?: number; lastSuccessAt?: number }): "skip" | "refresh" {
  const now = input.now ?? Date.now();
  const lastSuccessAt = input.lastSuccessAt ?? 0;
  const near = tokenNearExpiry(input.accessToken, now);
  if (input.reason === "unauthorized") {
    // A request that failed just after a renewal already has a new token. Renewing again
    // would send the same sign-in cookie twice. A failure with no recent renewal still renews,
    // so a revoked sign-in still ends instead of sitting on a dead token.
    if (input.accessToken && !near && lastSuccessAt > 0 && now - lastSuccessAt < MIN_PROACTIVE_GAP_MS) return "skip";
    return "refresh";
  }
  if (!input.accessToken) return input.reason === "bootstrap" ? "refresh" : "skip";
  if (!near) return "skip";
  if (lastSuccessAt > 0 && now - lastSuccessAt < MIN_PROACTIVE_GAP_MS) return "skip";
  return "refresh";
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
