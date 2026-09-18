import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { useAuthStore } from "../store/authStore";

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

/** Exported for useAuthBootstrap — the app's initial silent-session check runs through this same call. */
export async function refreshAccessToken(): Promise<string | null> {
  try {
    const { data } = await axios.post(
      `${apiClient.defaults.baseURL}/auth/refresh`,
      {},
      { withCredentials: true }
    );
    useAuthStore.getState().setAccessToken(data.accessToken);
    return data.accessToken as string;
  } catch {
    return null;
  }
}
