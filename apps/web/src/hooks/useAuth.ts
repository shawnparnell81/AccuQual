import { useMutation, useQueryClient } from "@tanstack/react-query";
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
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; password: string }) =>
      (await apiClient.post<AuthResponse>("/auth/login", input)).data,
    // Cross-user data leakage must be impossible — clear any query cache
    // left over from a previous session (someone logging back in as a
    // different user without ever hitting Logout, e.g. after their token
    // expired) before this new session's own queries start populating it.
    // Same guarantee useLogout's onSettled gives; needed here too since a
    // login can start a session without one ever having been explicitly
    // ended first. See the QA sweep review — a stale query cache used to
    // render a previous user's real NCR/supplier/financial numbers.
    onSuccess: (data) => {
      queryClient.clear();
      setSession(data.user, data.accessToken, data.refreshToken, data.tenant);
    },
  });
}

export function useRegister() {
  const setSession = useAuthStore((s) => s.setSession);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; password: string; name?: string; tenantCode: string }) =>
      (await apiClient.post<AuthResponse>("/auth/register", input)).data,
    // Same reasoning as useLogin's onSuccess above.
    onSuccess: (data) => {
      queryClient.clear();
      setSession(data.user, data.accessToken, data.refreshToken, data.tenant);
    },
  });
}

export function useLogout() {
  const logout = useAuthStore((s) => s.logout);
  const clearWindows = useWindowStore((s) => s.clear);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => apiClient.post("/auth/logout"),
    // Cross-tenant window leakage must be impossible — never let a stale
    // window survive into the next login, even for the same browser tab.
    // The query cache holds the same class of sensitive data (NCRs,
    // suppliers, financials) and used to survive logout unchanged — see
    // the QA sweep review.
    onSettled: () => {
      clearWindows();
      queryClient.clear();
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
