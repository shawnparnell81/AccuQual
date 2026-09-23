import { Link } from "react-router-dom";
import { useMfaStatus } from "../../routes/Settings/MfaSettingsSection";

/** Shown across the app while the organization requires two-step sign-in and this user is still inside their enrollment grace period. */
export function MfaGraceBanner() {
  const { data } = useMfaStatus();
  if (!data || data.state !== "grace" || !data.graceEndsAt) return null;
  return (
    <div className="border-b border-warning/40 bg-warning/10 px-6 py-2 text-sm print:hidden">
      Your organization requires two-step sign-in. Please{" "}
      <Link to="/settings" className="font-medium text-accent hover:underline">
        set it up in Settings → Security
      </Link>{" "}
      by {new Date(data.graceEndsAt).toLocaleDateString()}.
    </div>
  );
}
