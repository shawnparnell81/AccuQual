import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { useAuthStore, type AuthUser, type TenantContext } from "../store/authStore";
import { useWindowStore } from "../window-manager/useWindowStore";

interface AuthResponse {
  user: AuthUser;
  tenant?: TenantContext | null;
  accessToken: string;
  refreshToken: string;
}

export function useLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: async (input: { email: string; password: string }) =>
      (await apiClient.post<AuthResponse>("/auth/login", input)).data,
    onSuccess: (data) => setSession(data.user, data.accessToken, data.refreshToken, data.tenant),
  });
}

export function useRegister() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: async (input: { email: string; password: string; name?: string; tenantCode: string }) =>
      (await apiClient.post<AuthResponse>("/auth/register", input)).data,
    onSuccess: (data) => setSession(data.user, data.accessToken, data.refreshToken, data.tenant),
  });
}

export function useLogout() {
  const logout = useAuthStore((s) => s.logout);
  const clearWindows = useWindowStore((s) => s.clear);
  return useMutation({
    mutationFn: async () => apiClient.post("/auth/logout"),
    // Cross-tenant window leakage must be impossible — never let a stale
    // window survive into the next login, even for the same browser tab.
    onSettled: () => {
      clearWindows();
      logout();
    },
  });
}

export function useCurrentUser() {
  return useAuthStore((s) => s.user);
}

export function useCurrentTenant() {
  return useAuthStore((s) => s.tenant);
}
