import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { adoptBrowserSession, releaseBrowserSessionTab } from "../lib/browserSession";
import { useAuthStore, type AuthUser, type CompanyContext } from "../store/authStore";
import { useSiteStore } from "../store/siteStore";
import {
  classifyRefreshFailure,
  createSessionRefresher,
  nextProactiveDelayMs,
  refreshDecision,
  settleAfterRefresh,
  type RefreshReason,
  type RefreshResult,
} from "./sessionRefresh";

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "/api",
  // The refresh token now lives in an httpOnly cookie (see
  // auth.controller.ts) instead of somewhere JS can read it — this is what
  // makes the browser actually attach it to /auth/refresh and /auth/logout.
  withCredentials: true,
  // Anti-CSRF header (see services/api middleware/csrf.ts): the API refuses a
  // state-changing request carried by our cookie without it, and the browser's
  // cross-origin rules only let our own frontend add it. Sent on every call so
  // a stale cookie can never turn a login into a refusal.
  headers: { "X-AccuQual-Csrf": "1" },
});

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const accessToken = useAuthStore.getState().accessToken;
  if (accessToken) {
    config.headers.set("Authorization", `Bearer ${accessToken}`);
  }
  const siteId = useSiteStore.getState().currentSiteId;
  if (siteId) config.headers.set("X-AccuQual-Site", String(siteId));
  return config;
});

let lastSuccessAt = 0;
/** How many load-time checks in a row failed for a reason other than "signed out", so the next wait grows. */
let bootstrapMisses = 0;
let proactiveTimer: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<RefreshResult> | null = null;

const REFRESH_CHANNEL = "accuqual-session-refresh";
const REFRESH_LOCK = "accuqual-session-refresh";
/** How long a renewal another tab just finished can be reused, so this tab does not send the same cookie again. */
const SHARED_REFRESH_MS = 15_000;

interface SharedRefresh {
  at: number;
  result: RefreshResult;
  user?: AuthUser;
  company?: CompanyContext | null;
}

let sharedRefresh: SharedRefresh | null = null;
let refreshChannel: BroadcastChannel | null = null;

const refresher = createSessionRefresher({
  attempt: (attempt) => performRefreshAttempt(attempt),
});

function endSession() {
  releaseBrowserSessionTab();
  useAuthStore.getState().logout();
  useSiteStore.getState().setCurrentSiteId(null);
}

/** Clears a refresh cookie the browser restored after it was closed. The trusted-browser cookie is left in place. */
export async function abandonRestoredBrowserSession(): Promise<void> {
  try {
    await axios.post(
      `${apiClient.defaults.baseURL}/auth/end-browser-session`,
      {},
      { withCredentials: true, headers: { "X-AccuQual-Csrf": "1" } },
    );
  } catch {
    // The sign-in screen is shown either way. The next visit tries again.
  }
}

function listenForOtherTabs() {
  if (refreshChannel || typeof BroadcastChannel === "undefined") return;
  refreshChannel = new BroadcastChannel(REFRESH_CHANNEL);
  refreshChannel.onmessage = (event: MessageEvent<SharedRefresh>) => {
    const data = event.data;
    if (!data || typeof data.at !== "number" || Date.now() - data.at > SHARED_REFRESH_MS) return;
    sharedRefresh = data;
    if (data.result.ok && data.user) {
      lastSuccessAt = data.at;
      useAuthStore.getState().setSession(data.user, data.result.accessToken, data.company ?? null);
    } else if (!data.result.ok && data.result.logout) {
      endSession();
    }
  };
}

function rememberShared(result: RefreshResult) {
  const state = useAuthStore.getState();
  const message: SharedRefresh = {
    at: Date.now(),
    result,
    user: result.ok ? (state.user ?? undefined) : undefined,
    company: state.company,
  };
  sharedRefresh = message;
  try {
    refreshChannel?.postMessage(message);
  } catch {
    // A browser that refuses the channel still renews this tab. Other tabs retry on their own timer.
  }
}

function reuseSharedRefresh(): RefreshResult | null {
  if (!sharedRefresh || Date.now() - sharedRefresh.at > SHARED_REFRESH_MS) return null;
  if (!sharedRefresh.result.ok) return sharedRefresh.result;
  const token = useAuthStore.getState().accessToken;
  if (!token) return null;
  return { ok: true, accessToken: token };
}

function scheduleProactiveRefresh(token: string | null, delayOverride?: number) {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  proactiveTimer = undefined;
  const delay = delayOverride ?? (token ? nextProactiveDelayMs(token, Date.now(), lastSuccessAt) : null);
  if (delay == null) return;
  proactiveTimer = setTimeout(() => {
    const current = useAuthStore.getState().accessToken;
    // A signed-out retry (the first check failed before a token existed) is a bootstrap, not a proactive skip.
    void refreshSession(current ? "proactive" : "bootstrap");
  }, delay);
}

function settleRefreshResult(result: RefreshResult): RefreshResult {
  if (result.ok) {
    bootstrapMisses = 0;
    return result;
  }
  if (result.logout) {
    bootstrapMisses = 0;
    endSession();
  } else scheduleProactiveRefresh(useAuthStore.getState().accessToken, result.retryAfterMs);
  return result;
}

async function performRefreshAttempt(attempt: number) {
  try {
    const { data } = await axios.post<RefreshResponse>(
      `${apiClient.defaults.baseURL}/auth/refresh`,
      {},
      // X-AccuQual-Csrf (security-audit finding): this endpoint is
      // authenticated purely by an ambient cookie, so the backend requires
      // this header to force a CORS preflight — see middleware/csrf.ts.
      // The value carries no secret; only its presence matters.
      // Raw axios, not apiClient: a 401 from this call must not re-enter the interceptor.
      { withCredentials: true, headers: { "X-AccuQual-Csrf": "1" } },
    );
    // Stamp this before setSession. That update schedules the next renewal, and it
    // must see that a renewal just finished or it will fire another one immediately.
    lastSuccessAt = Date.now();
    adoptBrowserSession();
    useAuthStore.getState().setSession(data.user, data.accessToken, data.company);
    return { kind: "ok" as const, accessToken: data.accessToken };
  } catch (err) {
    if (!axios.isAxiosError(err)) return classifyRefreshFailure(undefined, null, attempt);
    const header = err.response?.headers?.["retry-after"];
    return classifyRefreshFailure(err.response?.status, typeof header === "string" ? header : null, attempt);
  }
}

/**
 * Exported for useAuthBootstrap — the app's initial silent-session check
 * runs through this same call. Applies the full `user`/`company` from the
 * response via `setSession`, not just the accessToken. A new tab does not
 * share this tab's sessionStorage, and a cleared store has no user or
 * company either. Leaving that tab with an access token and no company
 * would break every action (for example useWindowStore's openWindow) with
 * no way to recover short of a real re-login. auth.service.ts's `refresh()`
 * returns `company` so this call has something real to apply.
 *
 * One renewal at a time in this tab, and one across tabs (a lock plus a
 * same-tab message). A second tab waits and reuses the token the first tab
 * just received instead of sending the same cookie again — that second send
 * was coming back 401, and enough of them together came back 429.
 * A 401 right after a renewal replays with the new token instead of renewing
 * again. A 429 does not end the session; one retry is scheduled.
 */
export function refreshSession(reason: RefreshReason = "proactive"): Promise<RefreshResult> {
  const token = useAuthStore.getState().accessToken;
  if (refreshDecision({ reason, accessToken: token, lastSuccessAt }) === "skip") {
    if (inFlight) return inFlight;
    if (token) return Promise.resolve({ ok: true, accessToken: token });
  }
  if (!inFlight) {
    // The first check is a single try. Repeating a 500 inline leaves ProtectedRoute
    // rendering nothing until the backoff finishes, which is a blank page.
    inFlight = coordinatedRefresh(reason === "bootstrap").then(settleRefreshResult).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** One try. The load-time check uses this so a server error does not hold an empty page through the backoff sleeps. */
async function refreshOnce(): Promise<RefreshResult> {
  const outcome = await performRefreshAttempt(bootstrapMisses);
  if (outcome.kind === "ok") return { ok: true, accessToken: outcome.accessToken };
  if (outcome.kind === "unauthenticated") return { ok: false, logout: true };
  bootstrapMisses += 1;
  return { ok: false, logout: false, retryAfterMs: outcome.retryAfterMs };
}

async function coordinatedRefresh(once: boolean): Promise<RefreshResult> {
  listenForOtherTabs();
  const run = async () => {
    // Let a renewal message from the tab that just held this lock land before we send another request.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reused = reuseSharedRefresh();
    if (reused) return reused;
    const result = once ? await refreshOnce() : await refresher.refresh();
    rememberShared(result);
    return result;
  };
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request(REFRESH_LOCK, run);
  }
  return run();
}

export async function refreshAccessToken(): Promise<string | null> {
  const result = await refreshSession();
  return result.ok ? result.accessToken : null;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;

    if (error.response?.status === 401 && original && !original._retried && !isRefreshRequest(original)) {
      original._retried = true;
      const settled = await settleAfterRefresh(
        () => refreshSession("unauthorized"),
        (token) => {
          original.headers.set("Authorization", `Bearer ${token}`);
          return apiClient.request(original);
        },
        endSession,
      );
      if (settled.ok) return settled.value;
    }

    return Promise.reject(error);
  },
);

function isRefreshRequest(config: InternalAxiosRequestConfig): boolean {
  const url = config.url ?? "";
  return url.includes("/auth/refresh");
}

useAuthStore.subscribe((state, previous) => {
  if (state.accessToken !== previous.accessToken) scheduleProactiveRefresh(state.accessToken);
  if (state.accessToken && !previous.accessToken) adoptBrowserSession();
  if (!state.accessToken && previous.accessToken) releaseBrowserSessionTab();
});

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const token = useAuthStore.getState().accessToken;
    if (!token) return;
    if (nextProactiveDelayMs(token, Date.now(), lastSuccessAt) !== 0) return;
    void refreshSession("proactive");
  });
}

interface RefreshResponse {
  user: AuthUser;
  company?: CompanyContext | null;
  accessToken: string;
}
