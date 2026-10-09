import { Navigate, Outlet, useLocation } from "react-router-dom";
import { shouldRedirectToLogin } from "../../api/sessionRefresh";
import { useAuthStore } from "../../store/authStore";

/**
 * Redirects to /login only when the refresh cookie was refused (see useAuthBootstrap).
 * A 429, a 5xx, or a dropped connection sets `reconnecting` and leaves the address alone.
 * Waits on `bootstrapped` first so a page reload's in-flight silent-refresh check
 * doesn't get read as "logged out" and bounce a real session for one render.
 */
export function ProtectedRoute() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const bootstrapped = useAuthStore((s) => s.bootstrapped);
  const reconnecting = useAuthStore((s) => s.reconnecting);
  const { pathname } = useLocation();
  if (!bootstrapped) return null;
  if (reconnecting && !accessToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
        <p className="text-sm text-muted-foreground">Reconnecting your session…</p>
      </div>
    );
  }
  if (shouldRedirectToLogin({ accessToken, reconnecting })) {
    if (pathname === "/") {
      // The landing site is a standalone static page (public/welcome); its contact form finds the API through /welcome/config.js.
      window.location.replace("/welcome/index.html");
      return null;
    }
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
