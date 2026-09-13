import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { useWorkflowAction } from "../../hooks/useWorkflowAction";
import { apiClient } from "../../api/client";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { SelectField } from "../../components/forms/Field";
import type { InventoryAlert, InventoryAlertRouting } from "../../api/types";

const alertHooks = createResourceHooks<InventoryAlert>("inventory/alerts");

function useAlertRouting() {
  return useQuery<InventoryAlertRouting>({
    queryKey: ["inventory/alerts/routing"],
    queryFn: async () => (await apiClient.get("/inventory/alerts/routing")).data,
  });
}

const ALERT_TYPE_FILTERS = ["all", "below_min", "overstock"] as const;
const ACK_FILTERS = ["all", "open", "acknowledged"] as const;
const ITEM_TYPE_FILTERS = ["all", "raw_material", "wip", "finished_good"] as const;

/**
 * Every below_min/overstock alert raised by inventory.service.ts's
 * recomputeState, newest first, with filters + an Acknowledge action.
 * Current Stock/Min Level are live-joined at read time (see
 * listAlertsHandler) — never denormalized onto the alert row, so a later
 * item edit can't leave a stale number here.
 */
export function InventoryAlertsPage() {
  const navigate = useNavigate();
  const { data: alerts = [], isLoading } = alertHooks.useList();
  const { data: routing } = useAlertRouting();
  const acknowledgeAction = useWorkflowAction("inventory/alerts", "acknowledge", { successMessage: "Alert acknowledged." });

  const [alertTypeFilter, setAlertTypeFilter] = useState<(typeof ALERT_TYPE_FILTERS)[number]>("all");
  const [ackFilter, setAckFilter] = useState<(typeof ACK_FILTERS)[number]>("open");
  const [itemTypeFilter, setItemTypeFilter] = useState<(typeof ITEM_TYPE_FILTERS)[number]>("all");

  const filtered = useMemo(
    () =>
      alerts.filter((a) => {
        if (alertTypeFilter !== "all" && a.alertType !== alertTypeFilter) return false;
        if (ackFilter === "open" && a.acknowledgedAt) return false;
        if (ackFilter === "acknowledged" && !a.acknowledgedAt) return false;
        if (itemTypeFilter !== "all" && a.itemType !== itemTypeFilter) return false;
        return true;
      }),
    [alerts, alertTypeFilter, ackFilter, itemTypeFilter]
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Inventory Alerts</h1>

      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        A below-min alert notifies every active user in Material Management and Purchasing (no per-department "email setting" exists —
        see notification.service.ts).{" "}
        {routing && (
          <span className="text-foreground">
            Currently {routing.material_management} active {routing.material_management === 1 ? "user" : "users"} in Material Management,{" "}
            {routing.purchasing} in Purchasing.
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <SelectField label="Alert Type" value={alertTypeFilter} onChange={(e) => setAlertTypeFilter(e.target.value as typeof alertTypeFilter)}>
          {ALERT_TYPE_FILTERS.map((v) => (
            <option key={v} value={v}>
              {v === "all" ? "All types" : v.replace(/_/g, " ")}
            </option>
          ))}
        </SelectField>
        <SelectField label="Status" value={ackFilter} onChange={(e) => setAckFilter(e.target.value as typeof ackFilter)}>
          {ACK_FILTERS.map((v) => (
            <option key={v} value={v}>
              {v === "all" ? "All" : v === "open" ? "Open" : "Acknowledged"}
            </option>
          ))}
        </SelectField>
        <SelectField label="Item Type" value={itemTypeFilter} onChange={(e) => setItemTypeFilter(e.target.value as typeof itemTypeFilter)}>
          {ITEM_TYPE_FILTERS.map((v) => (
            <option key={v} value={v}>
              {v === "all" ? "All item types" : v.replace(/_/g, " ")}
            </option>
          ))}
        </SelectField>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {alerts.length === 0 ? "No alerts — every item is within its min/max range." : "No alerts match these filters."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">SKU</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 font-medium">Current Stock</th>
                <th className="px-4 py-2 font-medium">Min Level</th>
                <th className="px-4 py-2 font-medium">Alert Type</th>
                <th className="px-4 py-2 font-medium">Triggered</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id} className="cursor-pointer border-t border-border hover:bg-muted/50" onClick={() => navigate(`/inventory/${a.itemId}`)}>
                  <td className="px-4 py-2 font-medium">{a.sku}</td>
                  <td className="px-4 py-2 text-muted-foreground">{a.description ?? "—"}</td>
                  <td className="px-4 py-2">{a.currentStock}</td>
                  <td className="px-4 py-2">{a.minLevel}</td>
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
