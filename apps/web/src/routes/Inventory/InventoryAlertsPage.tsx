import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { useWorkflowAction } from "../../hooks/useWorkflowAction";
import { StatusBadge } from "../../components/tables/StatusBadge";
import type { InventoryAlert } from "../../api/types";

const alertHooks = createResourceHooks<InventoryAlert>("inventory/alerts");

/** Every below_min/overstock alert raised by inventory.service.ts's recomputeState, newest first, with an Acknowledge action. */
export function InventoryAlertsPage() {
  const navigate = useNavigate();
  const { data: alerts = [], isLoading } = alertHooks.useList();
  const acknowledgeAction = useWorkflowAction("inventory/alerts", "acknowledge", { successMessage: "Alert acknowledged." });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Inventory Alerts</h1>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : alerts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No alerts — every item is within its min/max range.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">SKU</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 font-medium">Alert Type</th>
                <th className="px-4 py-2 font-medium">Triggered</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id} className="cursor-pointer border-t border-border hover:bg-muted/50" onClick={() => navigate(`/inventory/${a.itemId}`)}>
                  <td className="px-4 py-2 font-medium">{a.sku}</td>
                  <td className="px-4 py-2 text-muted-foreground">{a.description ?? "—"}</td>
                  <td className="px-4 py-2 capitalize">{a.alertType.replace(/_/g, " ")}</td>
                  <td className="px-4 py-2 text-muted-foreground">{new Date(a.triggeredAt).toLocaleString()}</td>
                  <td className="px-4 py-2">
                    {a.acknowledgedAt ? <StatusBadge value="closed" label="Acknowledged" /> : <StatusBadge value="open" label="Open" />}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {!a.acknowledgedAt && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          acknowledgeAction.mutate({ id: a.id });
                        }}
                        disabled={acknowledgeAction.isPending}
                        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                      >
                        Acknowledge
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
