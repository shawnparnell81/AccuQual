import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { useAuthStore, type AuthUser, type CompanyContext } from "../store/authStore";
import { useSiteStore } from "../store/siteStore";
import {
  classifyRefreshFailure,
  createSessionRefresher,
  nextProactiveDelayMs,
  settleAfterRefresh,
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

let lastRefreshAt = 0;
let proactiveTimer: ReturnType<typeof setTimeout> | undefined;

const refresher = createSessionRefresher({
  attempt: (attempt) => performRefreshAttempt(attempt),
});

function endSession() {
  useAuthStore.getState().logout();
  useSiteStore.getState().setCurrentSiteId(null);
}

function scheduleProactiveRefresh(token: string | null, delayOverride?: number) {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  proactiveTimer = undefined;
  const delay = delayOverride ?? (token ? nextProactiveDelayMs(token, Date.now(), lastRefreshAt) : null);
  if (delay == null) return;
  proactiveTimer = setTimeout(() => {
    void refreshSession().then((result) => {
      if (result.ok) return;
      if (result.logout) endSession();
      else scheduleProactiveRefresh(useAuthStore.getState().accessToken, result.retryAfterMs);
    });
  }, delay);
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
 * response via `setSession`, not just the accessToken: a browser whose
 * persisted `user`/`company` (authStore's partialize) is missing — a
 * genuinely new device, or storage cleared without logging out first —
 * would otherwise refresh into an accessToken with no company context
 * anywhere in the client, breaking every action (e.g.
 * useWindowStore's openWindow) with no way to recover short of a real
 * re-login. auth.service.ts's `refresh()` was fixed to return `company` in
 * the same pass so this has something real to apply.
 *
 * Shares one in-flight renewal with the 401 interceptor and the timer that
 * renews shortly before the access token expires. A 429 does not end the
 * session; the caller should wait `retryAfterMs` and try again.
 */
export function refreshSession(): Promise<RefreshResult> {
  lastRefreshAt = Date.now();
  return refresher.refresh();
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
        () => refreshSession(),
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
});

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const token = useAuthStore.getState().accessToken;
    if (!token) return;
    if (nextProactiveDelayMs(token, Date.now(), lastRefreshAt) !== 0) return;
    void refreshSession().then((result) => {
      if (result.ok) return;
      if (result.logout) endSession();
      else scheduleProactiveRefresh(token, result.retryAfterMs);
    });
  });
}

interface RefreshResponse {
  user: AuthUser;
  company?: CompanyContext | null;
  accessToken: string;
}
