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
    // ended first. A stale query cache used to render a previous user's
    // real NCR/supplier/financial numbers.
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
    // suppliers, financials) and used to survive logout unchanged.
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
 * A page load starts with no access token in memory (see authStore.ts).
 * The httpOnly refresh cookie is used on a reload, a typed address in the
 * same tab, and a new tab while another AccuQual tab is open. A visit after
 * every AccuQual tab closed revokes it and shows the sign-in page, even if
 * the browser kept or restored the cookie (see browserSession.ts). The
 * trusted-browser cookie is not cleared. Runs once per app load, before ProtectedRoute has to
 * decide whether to bounce to /login.
 */
export function useAuthBootstrap() {
  const bootstrapped = useAuthStore((s) => s.bootstrapped);
  const setBootstrapped = useAuthStore((s) => s.setBootstrapped);
  const setReconnecting = useAuthStore((s) => s.setReconnecting);
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
    const holdForRetry = () => {
      if (cancelled) return;
      // The cookie was not refused. Leave the address alone; the refresher
      // already scheduled another try. Sending this tab to /login made a
      // later successful try look like a sign-in that nobody typed.
      setReconnecting(true);
      setBootstrapped();
    };
    void (async () => {
      // Closing every AccuQual tab ends the sign-in, even when the browser keeps
      // running or restores its session cookie. The cookie is revoked on the
      // server (recorded in login history) before the sign-in page shows.
      let visit: "continue" | "sign-in" = "sign-in";
      try {
        visit = await evaluateBrowserSessionOnLoad();
      } catch {
        visit = "continue";
      }
      if (cancelled) return;
      if (visit === "sign-in") {
        await abandonRestoredBrowserSession();
        finishSignedOut();
        return;
      }
      try {
        const result = await refreshSession("bootstrap");
        if (cancelled) return;
        const decision = bootstrapSessionDecision(result);
        if (decision === "signed-out") finishSignedOut();
        else if (decision === "retry") holdForRetry();
        else {
          setReconnecting(false);
          adoptBrowserSession();
          setBootstrapped();
        }
      } catch {
        holdForRetry();
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
