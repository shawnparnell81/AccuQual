import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "../../store/authStore";
import { apiClient } from "../../api/client";

/**
 * Redirects to /login when there's no session (the bare home address instead sends visitors to the public landing site in /welcome); otherwise renders the nested
 * routes. Waits on `bootstrapped` first (see useAuthBootstrap) so a page
 * reload's in-flight silent-refresh check doesn't get read as "logged out"
 * and bounce a real session for one render.
 */
export function ProtectedRoute() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const bootstrapped = useAuthStore((s) => s.bootstrapped);
  const { pathname } = useLocation();
  if (!bootstrapped) return null;
  if (!accessToken) {
    if (pathname === "/") {
      // The landing site is a standalone static page (public/welcome); it needs to know where this app's API lives to post its contact form.
      window.location.replace(`/welcome/index.html?api=${encodeURIComponent(String(apiClient.defaults.baseURL ?? "/api"))}`);
      return null;
    }
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
