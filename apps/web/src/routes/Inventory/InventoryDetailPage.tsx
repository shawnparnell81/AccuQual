import { useState } from "react";
import { useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { useWorkflowAction } from "../../hooks/useWorkflowAction";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import type { InventoryItem, InventoryMovement, InventoryAlert } from "../../api/types";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { Modal } from "../../components/modals/Modal";
import { TextField, SelectField } from "../../components/forms/Field";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

const itemHooks = createResourceHooks<InventoryItem>("inventory/items");
const alertHooks = createResourceHooks<InventoryAlert>("inventory/alerts");

function useMovementHistory(itemId: number | undefined) {
  return useQuery<InventoryMovement[]>({
    queryKey: ["inventory-movements", itemId],
    queryFn: async () => (await apiClient.get(`/inventory/items/${itemId}/history`)).data,
    enabled: itemId !== undefined,
  });
}

const MOVEMENT_TYPES = ["receive", "consume", "produce", "scrap", "transfer"] as const;

function LogMovementModal({ itemId, isOpen, onClose }: { itemId: number; isOpen: boolean; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ movementType: "receive", quantity: "", fromLocation: "", toLocation: "", reason: "" });
  const movementAction = useWorkflowAction<{ id: number } & Record<string, unknown>>("inventory/items", "movement", {
    successMessage: "Movement logged.",
    invalidateKeys: [["inventory-movements", itemId], ["workflow-history", "inventory", itemId]],
  });

  return (
    <Modal title="Log Movement" isOpen={isOpen} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          movementAction.mutate(
            { id: itemId, movementType: form.movementType, quantity: Number(form.quantity), fromLocation: form.fromLocation || undefined, toLocation: form.toLocation || undefined, reason: form.reason || undefined },
            {
              onSuccess: () => {
                onClose();
                setForm({ movementType: "receive", quantity: "", fromLocation: "", toLocation: "", reason: "" });
              },
              onError: (err) => toast.error(extractErrorMessage(err, "Couldn't log movement.")),
            }
          );
        }}
      >
        <SelectField label="Movement Type" value={form.movementType} onChange={(e) => setForm({ ...form, movementType: e.target.value })}>
          {MOVEMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </SelectField>
        <TextField label="Quantity" type="number" min="0" step="any" required value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
        {(form.movementType === "consume" || form.movementType === "scrap" || form.movementType === "transfer") && (
          <TextField label="From Location" value={form.fromLocation} onChange={(e) => setForm({ ...form, fromLocation: e.target.value })} />
        )}
        {(form.movementType === "receive" || form.movementType === "produce" || form.movementType === "transfer") && (
          <TextField label="To Location" value={form.toLocation} onChange={(e) => setForm({ ...form, toLocation: e.target.value })} />
        )}
        <TextField
          label={form.movementType === "scrap" ? "Reason" : "Reason (optional)"}
          required={form.movementType === "scrap"}
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
        />
        <button type="submit" disabled={movementAction.isPending} className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {movementAction.isPending ? "Logging…" : "Log Movement"}
        </button>
      </form>
    </Modal>
  );
}

/**
 * Item record + real per-location stock + movement ledger + Purchasing's
 * reorder/on-order actions + the shared WorkflowHistoryPanel (state-change
 * audit trail) — same shell shape as SupplierDetailPage, with "Log
 * Movement" replacing Supplier's status buttons as the primary action since
 * Inventory's own status changes are mostly derived from movements, not
 * chosen directly (see the Inventory module plan).
 */
export function InventoryDetailPage() {
  const { id } = useParams();
  const itemId = Number(id);
  const { data: item, isLoading } = itemHooks.useOne(itemId);
  const { data: movements = [] } = useMovementHistory(itemId);
  // Alert history for this item — the whole tenant's alerts are one small
  // list (same "fetch-and-filter" convention as listItemsHandler), so this
  // is a client-side filter rather than a second endpoint.
  const { data: allAlerts = [] } = alertHooks.useList();
  const itemAlerts = allAlerts.filter((a) => a.itemId === itemId);
  const [movementOpen, setMovementOpen] = useState(false);
  const historyKey: unknown[][] = [["workflow-history", "inventory", itemId]];

  const reorderPendingAction = useWorkflowAction("inventory/items", "mark-reorder-pending", { successMessage: "Marked reorder pending.", invalidateKeys: historyKey });
  const onOrderAction = useWorkflowAction("inventory/items", "mark-on-order", { successMessage: "Marked on order.", invalidateKeys: historyKey });
  const acknowledgeAction = useWorkflowAction("inventory/alerts", "acknowledge", { successMessage: "Alert acknowledged." });

  if (isLoading || !item) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{item.sku}</h1>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge value={item.state} />
            <span className="text-sm text-muted-foreground">{item.description}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <OpenFormButton formType="inventory_item" entityId={item.id} title={`Inventory Item #${item.id} Record`} label="Item Record" />
          <button onClick={() => setMovementOpen(true)} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
            Log Movement
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">Stock by Location</h3>
          {item.stock && item.stock.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2">Location</th>
                  <th className="pb-2">On Hand</th>
                  <th className="pb-2">Allocated</th>
                  <th className="pb-2">On Order</th>
                </tr>
              </thead>
              <tbody>
                {item.stock.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="py-1.5">{s.location}</td>
                    <td className="py-1.5">{s.onHand}</td>
                    <td className="py-1.5">{s.allocated}</td>
                    <td className="py-1.5">{s.onOrder}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">No stock recorded yet — log a "receive" movement to start.</p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Min {item.minLevel} / Max {item.maxLevel ?? "—"} / Reorder qty {item.reorderQuantity ?? "—"}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">Purchasing Actions</h3>
          <div className="flex flex-wrap gap-2">
            <WorkflowActionButton
              label="Mark Reorder Pending"
              navKey="inventory"
              action={reorderPendingAction}
              onClick={() => reorderPendingAction.mutate({ id: itemId })}
              visible={item.state === "below_min"}
            />
            <WorkflowActionButton
              label="Mark On Order"
              navKey="inventory"
              action={onOrderAction}
              onClick={() => onOrderAction.mutate({ id: itemId })}
              visible={item.state === "reorder_pending"}
            />
            {item.state !== "below_min" && item.state !== "reorder_pending" && <p className="text-sm text-muted-foreground">No reorder action applies to the current state.</p>}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Movement Ledger</h3>
        {movements.length === 0 ? (
          <p className="text-sm text-muted-foreground">No movements logged yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-2">When</th>
                <th className="pb-2">Type</th>
                <th className="pb-2">Qty</th>
                <th className="pb-2">From</th>
                <th className="pb-2">To</th>
                <th className="pb-2">Reason</th>
                <th className="pb-2">By</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id} className="border-t border-border">
                  <td className="py-1.5 text-muted-foreground">{new Date(m.performedAt).toLocaleString()}</td>
                  <td className="py-1.5 capitalize">{m.movementType}</td>
                  <td className="py-1.5">{m.quantity}</td>
                  <td className="py-1.5">{m.fromLocation ?? "—"}</td>
                  <td className="py-1.5">{m.toLocation ?? "—"}</td>
                  <td className="py-1.5 text-muted-foreground">{m.reason ?? "—"}</td>
                  {/* Raw user id, not a resolved name/email: GET /users (the only place that maps one to
                      the other) is admin/quality_manager-only, and this ledger is seen by every
                      edit-level department (material_management/purchasing/production too). */}
                  <td className="py-1.5 text-muted-foreground">{m.performedBy ? `User #${m.performedBy}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Alerts</h3>
        {itemAlerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No alerts raised for this item.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-2">Type</th>
                <th className="pb-2">Triggered</th>
                <th className="pb-2">Reorder Qty</th>
                <th className="pb-2">Status</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {itemAlerts.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="py-1.5 capitalize">{a.alertType.replace(/_/g, " ")}</td>
                  <td className="py-1.5 text-muted-foreground">{new Date(a.triggeredAt).toLocaleString()}</td>
                  <td className="py-1.5">{a.reorderQuantity ?? "—"}</td>
                  <td className="py-1.5">
                    {a.acknowledgedAt ? <StatusBadge value="closed" label="Acknowledged" /> : <StatusBadge value="open" label="Open" />}
                  </td>
                  <td className="py-1.5 text-right">
                    {!a.acknowledgedAt && (
                      <button
                        onClick={() => acknowledgeAction.mutate({ id: a.id })}
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
        )}
      </div>

      <WorkflowHistoryPanel moduleName="inventory" recordId={itemId} />

      <LogMovementModal itemId={itemId} isOpen={movementOpen} onClose={() => setMovementOpen(false)} />
    </div>
  );
}
