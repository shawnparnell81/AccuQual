import { useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { refreshSession } from "../../api/client";
import { shouldRedirectToLogin, showSessionReconnect } from "../../api/sessionRefresh";
import { isKnownAppPath } from "../../lib/sidebarAccess";
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
  if (showSessionReconnect({ reconnecting, accessToken, knownPath: isKnownAppPath(pathname) })) {
    return <SessionReconnect />;
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

/** Shown only when this tab has no access token and the refresh cookie could not be renewed. A 5xx on any other API call does not land here. */
function SessionReconnect() {
  const [pending, setPending] = useState(false);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-foreground">
      <p className="text-sm text-muted-foreground">Reconnecting your session…</p>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setPending(true);
          void refreshSession("bootstrap").finally(() => setPending(false));
        }}
        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60"
      >
        {pending ? "Trying…" : "Retry"}
      </button>
    </div>
  );
}
