import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

const AUTH_STORAGE_KEY = "accuqual-auth";

/** Drops a copy left by an older build. That copy lived in localStorage and kept the previous user after the browser closed. */
function dropPersistentAuthCopy() {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // Storage can be blocked. The session cookie is what signs the user in.
  }
}

/**
 * This tab only. A new tab does not see it; that tab signs in from the shared
 * session cookie. If sessionStorage is blocked, memory is enough for this tab.
 */
function tabAuthStorage(): StateStorage {
  try {
    const probe = "__accuqual_auth_probe__";
    sessionStorage.setItem(probe, "1");
    sessionStorage.removeItem(probe);
    return sessionStorage;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: (name) => memory.get(name) ?? null,
      setItem: (name, value) => {
        memory.set(name, value);
      },
      removeItem: (name) => {
        memory.delete(name);
      },
    };
  }
}

dropPersistentAuthCopy();

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  roleName: string | null;
  department: string | null;
  /** Set when an administrator assigned a temporary password. The app blocks every other page until this is cleared. */
  mustChangePassword?: boolean;
}

export interface CompanyContext {
  id: number;
  name: string;
  branding: { logoUrl?: string; primaryColor?: string; pdfHeader?: string; pdfFooter?: string };
}

interface AuthState {
  user: AuthUser | null;
  company: CompanyContext | null;
  accessToken: string | null;
  // Set once the initial silent-refresh check (useAuthBootstrap) has
  // resolved, so ProtectedRoute can tell "still checking" apart from
  // "definitely logged out" and doesn't bounce a real session to /login
  // for one render while that check is in flight.
  bootstrapped: boolean;
  setSession: (user: AuthUser, accessToken: string, company?: CompanyContext | null) => void;
  setAccessToken: (accessToken: string) => void;
  setBootstrapped: () => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      company: null,
      accessToken: null,
      bootstrapped: false,
      setSession: (user, accessToken, company = null) => set({ user, accessToken, company, bootstrapped: true }),
      setAccessToken: (accessToken) => set({ accessToken }),
      setBootstrapped: () => set({ bootstrapped: true }),
      logout: () => set({ user: null, company: null, accessToken: null }),
    }),
    {
      name: AUTH_STORAGE_KEY,
      // The access token stays in memory. The refresh token is the httpOnly
      // browser-session cookie (auth.controller.ts). A browser that restores
      // that cookie after it was closed does not stay signed in — see
      // browserSession.ts. The server still refuses the token 12 hours after
      // sign-in. user and company are display data for this tab, so a reload
      // can show them before the cookie refresh returns. They are not a
      // credential. A restored copy cannot carry an access token.
      storage: createJSONStorage(tabAuthStorage),
      partialize: (state) => ({ user: state.user, company: state.company }),
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as { user?: AuthUser | null; company?: CompanyContext | null };
        return {
          ...current,
          user: stored.user ?? null,
          company: stored.company ?? null,
          accessToken: null,
          bootstrapped: false,
        };
      },
    }
  )
);
