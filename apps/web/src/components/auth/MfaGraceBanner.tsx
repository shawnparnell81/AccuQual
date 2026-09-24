import { useState } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { useMfaStatus } from "../../routes/Settings/MfaSettingsSection";

const DISMISS_KEY = "accuqual-mfa-banner-dismissed";

/** Shown while the organization requires two-step sign-in and this user is still inside their enrollment grace period. One slim line; dismissing hides it for this browser session only. */
export function MfaGraceBanner() {
  const { data } = useMfaStatus();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  if (!data || data.state !== "grace" || !data.graceEndsAt || dismissed) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-warning/40 bg-warning/10 px-4 py-1 text-xs print:hidden">
      <span>
        Two-step sign-in is required.{" "}
        <Link to="/settings" className="font-medium text-accent hover:underline">
          Set it up in Settings → Security
        </Link>{" "}
        by {new Date(data.graceEndsAt).toLocaleDateString()}.
      </span>
      <button
        type="button"
        aria-label="Dismiss for now"
        onClick={() => {
          try {
            sessionStorage.setItem(DISMISS_KEY, "1");
          } catch {
            // Storage blocked: it simply comes back next load.
          }
          setDismissed(true);
        }}
        className="rounded p-0.5 text-muted-foreground hover:bg-warning/20"
      >
        <X size={13} />
      </button>
    </div>
  );
}
