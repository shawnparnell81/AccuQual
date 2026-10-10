import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { useDigitalTwinEnabled } from "../../hooks/useDigitalTwinEnabled";

/** Direct visits while the company flag is off. The pages behind this stay in the app. */
export function DigitalTwinGate({ children }: { children: ReactNode }) {
  const { enabled, ready } = useDigitalTwinEnabled();
  if (!ready) return <LoadingPlaceholder />;
  if (enabled) return children;
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-border bg-card p-6">
      <h1 className="text-2xl font-semibold">This feature is not enabled for your company</h1>
      <p className="mt-2 text-sm text-muted-foreground">Digital Twin is for companies that run a production line. It can be turned on later.</p>
      <Link to="/home" className="mt-4 inline-block text-sm text-primary hover:underline">
        Back to home
      </Link>
    </div>
  );
}
