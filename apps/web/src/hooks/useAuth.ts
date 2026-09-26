import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, refreshAccessToken } from "../api/client";
import { useAuthStore, type AuthUser, type CompanyContext } from "../store/authStore";
import { useWindowStore } from "../window-manager/useWindowStore";
import { clearCurrentPlant } from "./useSites";

export interface AuthResponse {
  user: AuthUser;
  company?: CompanyContext | null;
  accessToken: string;
  // No refreshToken field — it now arrives only as the httpOnly accuqual_rt
  // cookie (see auth.controller.ts), never in a JSON body frontend JS can read.
  /** Set while the company requires MFA but this user is still inside the enrollment grace period. */
  mfaGraceEndsAt?: string;
  /** Present once, right after enrollment — never retrievable again. */
  recoveryCodes?: string[];
}

/** The password was right but the sign-in is not finished: an authenticator code is needed, or the user must enroll first. */
export type LoginResponse = AuthResponse | { mfaRequired: true; mfaToken: string } | { mfaEnrollmentRequired: true; mfaToken: string };

export function isSession(r: LoginResponse): r is AuthResponse {
  return "accessToken" in r;
}

/** Starts a real session from a finished sign-in response. Clears the query cache first — same cross-user-leak reasoning as useLogin. */
export function useStartSession() {
  const setSession = useAuthStore((s) => s.setSession);
  const queryClient = useQueryClient();
  return (data: AuthResponse) => {
    queryClient.clear();
    clearCurrentPlant();
    setSession(data.user, data.accessToken, data.company);
  };
}

export function useLogin() {
  const startSession = useStartSession();
  return useMutation({
    mutationFn: async (input: { email: string; password: string; rememberMe?: boolean }) =>
      (await apiClient.post<LoginResponse>("/auth/login", input)).data,
    // Cross-user data leakage must be impossible — clear any query cache
    // left over from a previous session (someone logging back in as a
    // different user without ever hitting Logout, e.g. after their token
    // expired) before this new session's own queries start populating it.
    // Same guarantee useLogout's onSettled gives; needed here too since a
    // login can start a session without one ever having been explicitly
    // ended first. See the QA sweep review — a stale query cache used to
    // render a previous user's real NCR/supplier/financial numbers.
    // A response that still needs a second step has no session yet — the login page walks the user through it.
    onSuccess: (data) => {
      if (isSession(data)) startSession(data);
    },
  });
}

export function useLogout() {
  const logout = useAuthStore((s) => s.logout);
  const clearWindows = useWindowStore((s) => s.clear);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => apiClient.post("/auth/logout"),
    // Window leakage must be impossible — never let a stale
    // window survive into the next login, even for the same browser tab.
    // The query cache holds the same class of sensitive data (NCRs,
    // suppliers, financials) and used to survive logout unchanged — see
    // the QA sweep review.
    onSettled: () => {
      clearWindows();
      queryClient.clear();
      clearCurrentPlant();
      logout();
    },
  });
}

export function useCurrentUser() {
  return useAuthStore((s) => s.user);
}

export function useCurrentCompany() {
  return useAuthStore((s) => s.company);
}

/**
 * B2 fix: accessToken is no longer persisted (see authStore.ts), so a page
 * reload always starts with none in memory even though the httpOnly
 * accuqual_rt cookie may still be good. Runs once per app load to silently
 * try to mint a fresh accessToken from that cookie before ProtectedRoute
 * has to decide whether to bounce to /login — see ProtectedRoute.tsx's own
 * `bootstrapped` check.
 */
export function useAuthBootstrap() {
  const bootstrapped = useAuthStore((s) => s.bootstrapped);
  const setBootstrapped = useAuthStore((s) => s.setBootstrapped);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    if (bootstrapped) return;
    let cancelled = false;
    void refreshAccessToken().then((token) => {
      if (cancelled) return;
      // Deliberately unconditional, not just "when there's no token": a
      // browser that logged in before this fix shipped can still have an
      // old, now-stale accessToken sitting in this store from a previous
      // (pre-httpOnly-cookie) localStorage write, and that leftover value
      // must never substitute for a real check against the actual cookie —
      // it would leave `bootstrapped` false forever (ProtectedRoute renders
      // nothing while waiting on a check that never runs) since nothing
      // else in the app would ever call setBootstrapped for it.
      if (!token) logout(); // no valid cookie — drop any stale persisted user/company too
      setBootstrapped();
    });
    return () => {
      cancelled = true;
    };
    // Intentionally once per mount — bootstrapped is read only to decide
    // whether to even start, not to re-trigger this on every change it
    // itself causes.
  }, []);
}

/** Mid-sign-in MFA calls: they authenticate with the short-lived mfaToken from the password step, not a session. */
export const mfaApi = {
  verify: async (mfaToken: string, code: string, rememberMe = false) => (await apiClient.post<AuthResponse>("/auth/mfa/verify", { mfaToken, code, rememberMe })).data,
  enrollStart: async (mfaToken: string) => (await apiClient.post<{ secret: string; otpauthUri: string }>("/auth/mfa/enroll/start", { mfaToken })).data,
  enrollConfirm: async (mfaToken: string, code: string, rememberMe = false) => (await apiClient.post<AuthResponse>("/auth/mfa/enroll/confirm", { mfaToken, code, rememberMe })).data,
};
