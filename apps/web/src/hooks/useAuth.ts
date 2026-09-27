import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { abandonRestoredBrowserSession, apiClient, refreshSession } from "../api/client";
import { bootstrapSessionDecision } from "../api/sessionRefresh";
import { adoptBrowserSession, evaluateBrowserSessionOnLoad, releaseBrowserSessionTab } from "../lib/browserSession";
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
 * A page load starts with no access token in memory (see authStore.ts). The
 * httpOnly refresh cookie may still be present, including when the browser
 * restored it after being closed. That cookie is used only when this visit
 * is still the same open browser (a reload, or another tab). Otherwise the
 * cookie is cleared and the password is required again. The trusted-browser
 * cookie is not cleared. Runs once per app load, before ProtectedRoute has
 * to decide whether to bounce to /login.
 */
export function useAuthBootstrap() {
  const bootstrapped = useAuthStore((s) => s.bootstrapped);
  const setBootstrapped = useAuthStore((s) => s.setBootstrapped);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    if (bootstrapped) return;
    let cancelled = false;
    const finishSignedOut = () => {
      if (cancelled) return;
      releaseBrowserSessionTab();
      logout();
      setBootstrapped();
    };
    void (async () => {
      let decision: "continue" | "sign-in" = "sign-in";
      try {
        decision = await evaluateBrowserSessionOnLoad();
      } catch {
        decision = "sign-in";
      }
      if (cancelled) return;
      if (decision === "sign-in") {
        await abandonRestoredBrowserSession();
        finishSignedOut();
        return;
      }
      adoptBrowserSession();
      try {
        const result = await refreshSession("bootstrap");
        if (cancelled) return;
        // A server error used to leave `bootstrapped` false, and ProtectedRoute
        // renders nothing until that flag is set — a failed check was a blank page.
        // Signed out is the fallback. A retry scheduled by the refresher can still
        // restore the session if the cookie is good.
        if (bootstrapSessionDecision(result) === "signed-out") finishSignedOut();
        else setBootstrapped();
      } catch {
        finishSignedOut();
      }
    })();
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
  verify: async (mfaToken: string, code: string, rememberMe = false, trustDevice = false) => (await apiClient.post<AuthResponse>("/auth/mfa/verify", { mfaToken, code, rememberMe, trustDevice })).data,
  enrollStart: async (mfaToken: string) => (await apiClient.post<{ secret: string; otpauthUri: string }>("/auth/mfa/enroll/start", { mfaToken })).data,
  enrollConfirm: async (mfaToken: string, code: string, rememberMe = false, trustDevice = false) => (await apiClient.post<AuthResponse>("/auth/mfa/enroll/confirm", { mfaToken, code, rememberMe, trustDevice })).data,
};
