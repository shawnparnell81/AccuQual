import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "../../store/authStore";

/**
 * Redirects to /login when there's no session; otherwise renders the nested
 * routes. Waits on `bootstrapped` first (see useAuthBootstrap) so a page
 * reload's in-flight silent-refresh check doesn't get read as "logged out"
 * and bounce a real session for one render.
 */
export function ProtectedRoute() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const bootstrapped = useAuthStore((s) => s.bootstrapped);
  if (!bootstrapped) return null;
  if (!accessToken) return <Navigate to="/login" replace />;
  return <Outlet />;
}
