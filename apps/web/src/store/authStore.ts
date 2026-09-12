import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  tenantId: number | null; // null only for platform admins
  roleName: string | null;
}

export interface TenantContext {
  id: number;
  name: string;
  code: string;
  branding: { logoUrl?: string; primaryColor?: string; pdfHeader?: string; pdfFooter?: string };
}

interface AuthState {
  user: AuthUser | null;
  tenant: TenantContext | null;
  accessToken: string | null;
  refreshToken: string | null;
  setSession: (user: AuthUser, accessToken: string, refreshToken: string, tenant?: TenantContext | null) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      tenant: null,
      accessToken: null,
      refreshToken: null,
      setSession: (user, accessToken, refreshToken, tenant = null) => set({ user, accessToken, refreshToken, tenant }),
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      logout: () => set({ user: null, tenant: null, accessToken: null, refreshToken: null }),
    }),
    { name: "accuqual-auth" }
  )
);
