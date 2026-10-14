import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { useDigitalTwinEnabled } from "../../hooks/useDigitalTwinEnabled";

/** Direct visits while Receiving & Inventory is off. The pages behind this stay in the app. */
export function ReceivingInventoryGate({ children }: { children: ReactNode }) {
  const { receivingInventory, ready } = useDigitalTwinEnabled();
  if (!ready) return <LoadingPlaceholder />;
  if (receivingInventory) return children;
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-border bg-card p-6">
      <h1 className="text-2xl font-semibold">Receiving &amp; Inventory is not available</h1>
      <p className="mt-2 text-sm text-muted-foreground">An administrator can turn it on in Admin Console, Company Settings.</p>
      <Link to="/home" className="mt-4 inline-block text-sm text-primary hover:underline">
        Back to home
      </Link>
    </div>
  );
}
