import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { useWorkflowAction } from "../../hooks/useWorkflowAction";
import { useCurrentUser } from "../../hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import type { InventoryItem, InventoryMovement, InventoryAlert, InventoryReorderRequest, Supplier, ItemCosting } from "../../api/types";
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
const reorderRequestHooks = createResourceHooks<InventoryReorderRequest>("inventory/reorder-requests");
const supplierHooks = createResourceHooks<Supplier>("suppliers");

function useMovementHistory(itemId: number | undefined) {
  return useQuery<InventoryMovement[]>({
    queryKey: ["inventory-movements", itemId],
    queryFn: async () => (await apiClient.get(`/inventory/items/${itemId}/history`)).data,
    enabled: itemId !== undefined,
  });
}

function useItemCosting(itemId: number | undefined) {
  return useQuery<ItemCosting>({
    queryKey: ["inventory/costing", itemId],
    queryFn: async () => (await apiClient.get(`/inventory/costing/${itemId}`)).data,
    enabled: itemId !== undefined,
  });
}

const currency = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MOVEMENT_TYPES = ["receive", "consume", "produce", "scrap", "transfer"] as const;
// Free-form examples, not an enum — there's no Production Work Order module
// (or anything else) to validate these against. "Custom…" lets someone type
// a value this list didn't anticipate rather than being stuck with these three.
const REFERENCE_TYPE_OPTIONS = ["", "production_log", "manual", "batch"] as const;

function LogMovementModal({ itemId, isOpen, onClose }: { itemId: number; isOpen: boolean; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ movementType: "receive", quantity: "", fromLocation: "", toLocation: "", reason: "", referenceType: "", referenceTypeCustom: "", referenceId: "" });
  const movementAction = useWorkflowAction<{ id: number } & Record<string, unknown>>("inventory/items", "movement", {
    successMessage: "Movement logged.",
    invalidateKeys: [["inventory-movements", itemId], ["workflow-history", "inventory", itemId]],
  });

  const resolvedReferenceType = form.referenceType === "custom" ? form.referenceTypeCustom : form.referenceType;

  return (
    <Modal title="Log Movement" isOpen={isOpen} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          movementAction.mutate(
            {
              id: itemId,
              movementType: form.movementType,
              quantity: Number(form.quantity),
              fromLocation: form.fromLocation || undefined,
              toLocation: form.toLocation || undefined,
              reason: form.reason || undefined,
              referenceType: resolvedReferenceType || undefined,
              referenceId: form.referenceId || undefined,
            },
            {
              onSuccess: () => {
                onClose();
                setForm({ movementType: "receive", quantity: "", fromLocation: "", toLocation: "", reason: "", referenceType: "", referenceTypeCustom: "", referenceId: "" });
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
        <div className={form.referenceType === "custom" ? "grid grid-cols-2 gap-3" : ""}>
          <SelectField label="Reference Type (optional)" value={form.referenceType} onChange={(e) => setForm({ ...form, referenceType: e.target.value })}>
            {REFERENCE_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t === "" ? "None" : t.replace(/_/g, " ")}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </SelectField>
          {form.referenceType === "custom" && (
            <TextField label="Custom Type" value={form.referenceTypeCustom} onChange={(e) => setForm({ ...form, referenceTypeCustom: e.target.value })} />
          )}
        </div>
        {form.referenceType !== "" && (
          <TextField
            label="Reference ID (optional)"
            placeholder='e.g. "PL-2024-001", "Batch 17"'
            value={form.referenceId}
            onChange={(e) => setForm({ ...form, referenceId: e.target.value })}
          />
        )}
        <button type="submit" disabled={movementAction.isPending} className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {movementAction.isPending ? "Logging…" : "Log Movement"}
        </button>
      </form>
    </Modal>
  );
}

/**
 * One reorder request row — a minimal ERP stub (see the ERP Reorder Request
 * review): created only when Purchasing marks the item reorder_pending,
 * never by an external ERP integration (none exists). Send/Ignore/notes are
 * all real Purchasing actions on a real row, not a simulated third-party
 * sync.
 */
function ReorderRequestRow({ request, canEdit }: { request: InventoryReorderRequest; canEdit: boolean }) {
  const toast = useToast();
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState(request.notes ?? "");
  const historyKey: unknown[][] = [["workflow-history", "inventory", request.itemId]];
  const itemKey: unknown[][] = [["inventory/items", request.itemId]];

  const sendAction = useWorkflowAction("inventory/reorder-requests", "send", { successMessage: "Reorder request sent.", invalidateKeys: [...itemKey, ...historyKey] });
  const ignoreAction = useWorkflowAction("inventory/reorder-requests", "ignore", { successMessage: "Reorder request ignored.", invalidateKeys: [...itemKey, ...historyKey] });
  const notesAction = useWorkflowAction<{ id: number; notes: string }>("inventory/reorder-requests", "notes", { successMessage: "Note saved." });

  return (
    <tr className="border-t border-border align-top">
      <td className="py-1.5">{request.requestedQty}</td>
      <td className="py-1.5">
        <StatusBadge value={request.status === "sent" ? "closed" : request.status === "ignored" ? "rejected" : "open"} label={request.status} />
      </td>
      <td className="py-1.5 text-muted-foreground">{new Date(request.createdAt).toLocaleString()}</td>
      <td className="py-1.5">
        {editingNotes ? (
          <div className="flex items-center gap-1">
            <TextField label="" value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} />
            <button
              onClick={() =>
                notesAction.mutate(
                  { id: request.id, notes: notesDraft },
                  { onSuccess: () => setEditingNotes(false), onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save note.")) }
                )
              }
              disabled={notesAction.isPending}
              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
            >
              Save
            </button>
          </div>
        ) : (
          <button onClick={() => canEdit && setEditingNotes(true)} className={`text-left text-muted-foreground ${canEdit ? "hover:underline" : "cursor-default"}`}>
            {request.notes || (canEdit ? "Add note…" : "—")}
          </button>
        )}
      </td>
      <td className="py-1.5 text-right">
        {request.status === "pending" && canEdit && (
          <div className="flex justify-end gap-2">
            <button
              onClick={() => sendAction.mutate({ id: request.id })}
              disabled={sendAction.isPending}
              className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              Send
            </button>
            <button
              onClick={() => ignoreAction.mutate({ id: request.id })}
              disabled={ignoreAction.isPending}
              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
            >
              Ignore
            </button>
          </div>
        )}
      </td>
    </tr>
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
  const { data: reorderRequests = [] } = reorderRequestHooks.useList({ itemId });
  const { data: suppliers = [] } = supplierHooks.useList();
  const { data: costing } = useItemCosting(itemId);
  const currentUser = useCurrentUser();
  const canManageReorder = currentUser?.roleName === "admin" || currentUser?.roleName === "platform_admin" || currentUser?.department === "purchasing";
  const updateItem = itemHooks.useUpdate();
  const [editingSupplier, setEditingSupplier] = useState(false);
  const [editingCost, setEditingCost] = useState(false);
  const [costDraft, setCostDraft] = useState("");
  const [movementOpen, setMovementOpen] = useState(false);
  const [referenceTypeFilter, setReferenceTypeFilter] = useState("all");
  const referenceTypes = useMemo(() => Array.from(new Set(movements.map((m) => m.referenceType).filter((t): t is string => !!t))), [movements]);
  const filteredMovements = referenceTypeFilter === "all" ? movements : movements.filter((m) => m.referenceType === referenceTypeFilter);
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
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Supplier:</span>
            {editingSupplier ? (
              <>
                <select
                  className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                  defaultValue={item.defaultSupplierId ?? ""}
                  onChange={(e) => {
                    const value = e.target.value ? Number(e.target.value) : null;
                    updateItem.mutate({ id: itemId, defaultSupplierId: value } as Partial<InventoryItem> & { id: number }, { onSuccess: () => setEditingSupplier(false) });
                  }}
                >
                  <option value="">None</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button onClick={() => setEditingSupplier(false)} className="text-xs text-muted-foreground hover:underline">
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={() => setEditingSupplier(true)} className="text-primary hover:underline">
                {suppliers.find((s) => s.id === item.defaultSupplierId)?.name ?? "None set — click to link"}
              </button>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Unit Cost:</span>
            {editingCost ? (
              <>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  autoFocus
                  defaultValue={item.unitCost ?? ""}
                  onChange={(e) => setCostDraft(e.target.value)}
                  className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm"
                />
                <button
                  onClick={() =>
                    updateItem.mutate({ id: itemId, unitCost: costDraft === "" ? null : Number(costDraft) } as Partial<InventoryItem> & { id: number }, {
                      onSuccess: () => setEditingCost(false),
                    })
                  }
                  className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                >
                  Save
                </button>
                <button onClick={() => setEditingCost(false)} className="text-xs text-muted-foreground hover:underline">
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={() => setEditingCost(true)} className="text-primary hover:underline">
                {item.unitCost !== null ? currency(Number(item.unitCost)) : "Not set — click to set"}
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <OpenFormButton formType="inventory_item" entityId={item.id} title={`Inventory Item #${item.id} Record`} label="Item Record" />
          <button onClick={() => setMovementOpen(true)} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
            Log Movement
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
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

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">Costing</h3>
          {!costing ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : costing.unitCost === null ? (
            <p className="text-sm text-muted-foreground">No unit cost set — set one above to see item value and scrap/consumption cost.</p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Unit Cost</dt>
              <dd className="text-right tabular-nums">{currency(costing.unitCost)}</dd>
              <dt className="text-muted-foreground">On Hand</dt>
              <dd className="text-right tabular-nums">{costing.onHand}</dd>
              <dt className="font-medium">Item Value</dt>
              <dd className="text-right font-medium tabular-nums">{currency(costing.itemValue!)}</dd>
              <dt className="text-muted-foreground">Scrap Cost ({costing.days}d)</dt>
              <dd className="text-right tabular-nums">{currency(costing.scrapCost!)}</dd>
              <dt className="text-muted-foreground">Consumption Cost ({costing.days}d)</dt>
              <dd className="text-right tabular-nums">{currency(costing.consumptionCost!)}</dd>
            </dl>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Today's unit cost applied to past movements — AccuQual keeps no FIFO/LIFO cost history, so this is an estimate at current
            pricing, not the actual cost paid at the time.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Reorder Requests</h3>
        {reorderRequests.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No reorder requests — one is created automatically the moment Purchasing marks this item reorder pending. This is a minimal
            stub, not a live ERP connection (none exists).
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-2">Requested Qty</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Created</th>
                <th className="pb-2">Notes</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {reorderRequests.map((r) => (
                <ReorderRequestRow key={r.id} request={r} canEdit={canManageReorder} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium">Movement Ledger</h3>
          {referenceTypes.length > 0 && (
            <SelectField label="" value={referenceTypeFilter} onChange={(e) => setReferenceTypeFilter(e.target.value)}>
              <option value="all">All references</option>
              {referenceTypes.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </SelectField>
          )}
        </div>
        {movements.length === 0 ? (
          <p className="text-sm text-muted-foreground">No movements logged yet.</p>
        ) : filteredMovements.length === 0 ? (
          <p className="text-sm text-muted-foreground">No movements match this reference type.</p>
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
                <th className="pb-2">Reference</th>
                <th className="pb-2">By</th>
              </tr>
            </thead>
            <tbody>
              {filteredMovements.map((m) => (
                <tr key={m.id} className="border-t border-border">
                  <td className="py-1.5 text-muted-foreground">{new Date(m.performedAt).toLocaleString()}</td>
                  <td className="py-1.5 capitalize">{m.movementType}</td>
                  <td className="py-1.5">{m.quantity}</td>
                  <td className="py-1.5">{m.fromLocation ?? "—"}</td>
                  <td className="py-1.5">{m.toLocation ?? "—"}</td>
                  <td className="py-1.5 text-muted-foreground">{m.reason ?? "—"}</td>
                  <td className="py-1.5 text-muted-foreground">
                    {m.referenceType ? `${m.referenceType.replace(/_/g, " ")}${m.referenceId ? `: ${m.referenceId}` : ""}` : "—"}
                  </td>
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
