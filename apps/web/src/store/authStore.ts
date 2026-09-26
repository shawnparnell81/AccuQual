import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  roleName: string | null;
  department: string | null;
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
      name: "accuqual-auth",
      // B2 fix: the access token used to be persisted here too, alongside a
      // long-lived refresh token that has since moved to an httpOnly cookie
      // (see auth.controller.ts) — either one sitting in localStorage is a
      // bearer credential any XSS on the page could read straight out from
      // under it. Only `user`/`company` (display data, not credentials) are
      // worth keeping across a reload now; accessToken starts null on every
      // fresh load and useAuthBootstrap re-mints one from the cookie.
      partialize: (state) => ({ user: state.user, company: state.company }),
    }
  )
);
