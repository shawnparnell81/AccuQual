import { lazy, Suspense } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "../../store/authStore";

const LandingPage = lazy(() => import("../../routes/Landing/LandingPage").then((m) => ({ default: m.LandingPage })));

/**
 * Redirects to /login when there's no session (the bare home address instead shows the public landing page); otherwise renders the nested
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
    return pathname === "/" ? (
      <Suspense fallback={null}>
        <LandingPage />
      </Suspense>
    ) : (
      <Navigate to="/login" replace />
    );
  }
  return <Outlet />;
}
