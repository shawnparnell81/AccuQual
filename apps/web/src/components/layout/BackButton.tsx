import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import clsx from "clsx";

/**
 * A real, global "go back" — rendered once inside TopNav so every one of
 * the ~25 detail pages (NCR, CAPA, CRAR, Audit, Document, ...) gets it for
 * free instead of each hand-rolling its own "← Back to list" link (only
 * ScarFormDetailPage.tsx had bothered to before this). Plain router-history
 * back, not a per-record "back to list" — works uniformly regardless of
 * what page you came from.
 *
 * Disabled until at least one real in-app navigation has happened this
 * session: `navigate(-1)` on the very first page would walk out of the SPA
 * into whatever the browser tab's history held before the app loaded
 * (a previous site, or nothing) — this counter (not React Router's own
 * history, which doesn't expose stack depth) is the simplest way to know
 * there's actually somewhere in-app to go back to.
 */
export function BackButton() {
  const location = useLocation();
  const navigate = useNavigate();
  const visitCount = useRef(0);
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    visitCount.current += 1;
    if (visitCount.current > 1) setCanGoBack(true);
  }, [location.pathname]);

  return (
    <button
      type="button"
      onClick={() => navigate(-1)}
      disabled={!canGoBack}
      title="Go back"
      aria-label="Go back"
      className={clsx("aq-icon-btn aq-hide-sm", !canGoBack && "opacity-40")}
    >
      <ArrowLeft size={18} />
    </button>
  );
}
