import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "../../store/authStore";

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
      // The landing site is a standalone static page (public/welcome); its contact form finds the API through /welcome/config.js.
      window.location.replace("/welcome/index.html");
      return null;
    }
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
