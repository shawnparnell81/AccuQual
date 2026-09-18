import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { useAuthStore, type AuthUser, type TenantContext } from "../store/authStore";

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "/api",
  // The refresh token now lives in an httpOnly cookie (see
  // auth.controller.ts) instead of somewhere JS can read it — this is what
  // makes the browser actually attach it to /auth/refresh and /auth/logout.
  withCredentials: true,
});

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const accessToken = useAuthStore.getState().accessToken;
  if (accessToken) {
    config.headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return config;
});

let refreshInFlight: Promise<string | null> | null = null;

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;

    if (error.response?.status === 401 && original && !original._retried) {
      original._retried = true;

      if (!refreshInFlight) {
        refreshInFlight = refreshAccessToken();
      }
      const newToken = await refreshInFlight;
      refreshInFlight = null;

      if (newToken) {
        original.headers.set("Authorization", `Bearer ${newToken}`);
        return apiClient.request(original);
      }

      useAuthStore.getState().logout();
    }

    return Promise.reject(error);
  }
);

interface RefreshResponse {
  user: AuthUser;
  tenant?: TenantContext | null;
  accessToken: string;
}

/**
 * Exported for useAuthBootstrap — the app's initial silent-session check
 * runs through this same call. Applies the full `user`/`tenant` from the
 * response via `setSession`, not just the accessToken: a browser whose
 * persisted `user`/`tenant` (authStore's partialize) is missing — a
 * genuinely new device, or storage cleared without logging out first —
 * would otherwise refresh into an accessToken with no tenant context
 * anywhere in the client, breaking every tenant-scoped action (e.g.
 * useWindowStore's openWindow) with no way to recover short of a real
 * re-login. auth.service.ts's `refresh()` was fixed to return `tenant` in
 * the same pass so this has something real to apply.
 */
export async function refreshAccessToken(): Promise<string | null> {
  try {
    const { data } = await axios.post<RefreshResponse>(
      `${apiClient.defaults.baseURL}/auth/refresh`,
      {},
      { withCredentials: true }
    );
    useAuthStore.getState().setSession(data.user, data.accessToken, data.tenant);
    return data.accessToken;
  } catch {
    return null;
  }
}
