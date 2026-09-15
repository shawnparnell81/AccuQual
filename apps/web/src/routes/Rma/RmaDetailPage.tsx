import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { createResourceHooks } from "../../api/resourceHooks";
import { useWorkflowAction, extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useCurrentUser } from "../../hooks/useAuth";
import { useToast } from "../../components/shared/ToastProvider";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { CreateFeasibilityButton } from "../../components/shared/CreateFeasibilityButton";
import { LinkSalesAccountButton } from "../../components/shared/LinkSalesAccountButton";
import { CreateCustomerButton } from "../../components/shared/CreateCustomerButton";
import { Modal } from "../../components/modals/Modal";
import { TextField, SelectField, TextAreaField } from "../../components/forms/Field";
import type { Rma, RmaItem, InventoryItem, Ncr, Capa, RmaStatus } from "../../api/types";

const rmaHooks = createResourceHooks<Rma>("rma");
const itemHooks = createResourceHooks<InventoryItem>("inventory/items");
const ncrHooks = createResourceHooks<Ncr>("ncr");
const capaHooks = createResourceHooks<Capa>("capa");

const REASON_CODES = ["defective", "wrong_item", "over_shipment", "under_shipment", "quality_issue", "other"];

/** Same allowed-next-status shape as rma.controller.ts's ALLOWED_NEXT — duplicated here only for which buttons to show; the server is the actual source of truth and re-validates on every call. */
const NEXT_STATUS: Record<RmaStatus, { status: RmaStatus; label: string }[]> = {
  draft: [
    { status: "submitted_to_supplier", label: "Submit to Supplier" },
    { status: "cancelled", label: "Cancel" },
  ],
  submitted_to_supplier: [
    { status: "approved_by_supplier", label: "Record Supplier Approval" },
    { status: "cancelled", label: "Cancel" },
  ],
  approved_by_supplier: [
    { status: "in_transit", label: "Mark In Transit" },
    { status: "cancelled", label: "Cancel" },
  ],
  in_transit: [
    { status: "received_by_supplier", label: "Mark Received by Supplier" },
    { status: "cancelled", label: "Cancel" },
  ],
  received_by_supplier: [
    { status: "closed", label: "Close RMA" },
    { status: "cancelled", label: "Cancel" },
  ],
  closed: [],
  cancelled: [],
};

/** Client-side mirror of rma.controller.ts's STATUS_TRANSITION_DEPARTMENTS — a UI convenience (hide buttons a user can't use), not the enforcement, which is server-side and re-checked on every call. */
const TRANSITION_DEPARTMENTS: Record<string, string[]> = {
  submitted_to_supplier: ["purchasing", "material_management"],
  approved_by_supplier: ["purchasing"],
  in_transit: ["purchasing", "material_management"],
  received_by_supplier: ["purchasing", "material_management"],
  closed: ["purchasing"],
  cancelled: ["purchasing", "material_management"],
};

function AddItemModal({ rmaId, isOpen, onClose }: { rmaId: number; isOpen: boolean; onClose: () => void }) {
  const toast = useToast();
  const { data: items = [] } = itemHooks.useList();
  const [form, setForm] = useState({ itemId: "", description: "", quantityReturned: "", unitOfMeasure: "", reason: "" });
  const addItem = useWorkflowAction<{ id: number } & Record<string, unknown>>("rma", "items", {
    successMessage: "Item added.",
    invalidateKeys: [["rma", rmaId]],
  });

  return (
    <Modal title="Add Returned Item" isOpen={isOpen} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          addItem.mutate(
            {
              id: rmaId,
              itemId: Number(form.itemId),
              description: form.description || undefined,
              quantityReturned: Number(form.quantityReturned),
              unitOfMeasure: form.unitOfMeasure || undefined,
              reason: form.reason || undefined,
            },
            {
              onSuccess: () => {
                onClose();
                setForm({ itemId: "", description: "", quantityReturned: "", unitOfMeasure: "", reason: "" });
              },
              onError: (err) => toast.error(extractErrorMessage(err, "Couldn't add item.")),
            }
          );
        }}
      >
        <SelectField label="Item" required value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })}>
          <option value="">Select an item…</option>
          {items.map((it) => (
            <option key={it.id} value={it.id}>
              {it.sku}
            </option>
          ))}
        </SelectField>
        <TextField label="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Quantity Returned" type="number" min="0" step="any" required value={form.quantityReturned} onChange={(e) => setForm({ ...form, quantityReturned: e.target.value })} />
          <TextField label="Unit of Measure" value={form.unitOfMeasure} onChange={(e) => setForm({ ...form, unitOfMeasure: e.target.value })} />
        </div>
        <TextField label="Reason (optional)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        <button type="submit" disabled={addItem.isPending} className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {addItem.isPending ? "Adding…" : "Add Item"}
        </button>
      </form>
    </Modal>
  );
}

/** Inline-editable supplierResponse cell — same click-to-edit pattern as InventoryDetailPage's ReorderRequestRow notes column. Uses a bespoke PATCH mutation (not useWorkflowAction's flat `/resource/:id/:action` shape) since the real endpoint is nested two levels: /rma/:id/items/:itemId. */
function ItemRow({ item, rmaId, canEdit }: { item: RmaItem; rmaId: number; canEdit: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.supplierResponse ?? "");

  const save = useMutation({
    mutationFn: async () => (await apiClient.patch(`/rma/${rmaId}/items/${item.id}`, { supplierResponse: draft })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rma", rmaId] });
      setEditing(false);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save supplier response.")),
  });

  return (
    <tr className="border-t border-border align-top">
      <td className="py-1.5">{item.sku ?? `Item #${item.itemId}`}</td>
      <td className="py-1.5 text-muted-foreground">{item.description ?? "—"}</td>
      <td className="py-1.5">
        {item.quantityReturned} {item.unitOfMeasure ?? ""}
      </td>
      <td className="py-1.5 text-muted-foreground">{item.reason ?? "—"}</td>
      <td className="py-1.5">
        {editing ? (
          <div className="flex items-center gap-1">
            <TextField label="" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button onClick={() => save.mutate()} disabled={save.isPending} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">
              Save
            </button>
          </div>
        ) : (
          <button onClick={() => canEdit && setEditing(true)} className={`text-left text-muted-foreground ${canEdit ? "hover:underline" : "cursor-default"}`}>
            {item.supplierResponse || (canEdit ? "Add response…" : "—")}
          </button>
        )}
      </td>
    </tr>
  );
}

export function RmaDetailPage() {
  const { id } = useParams();
  const rmaId = Number(id);
  const { data: record, isLoading } = rmaHooks.useOne(rmaId);
  const currentUser = useCurrentUser();
  const { data: ncrs = [] } = ncrHooks.useList();
  const { data: capas = [] } = capaHooks.useList();
  const updateRma = rmaHooks.useUpdate();
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");

  const statusAction = useWorkflowAction<{ id: number; status: string }>("rma", "status", {
    successMessage: "RMA status updated.",
    invalidateKeys: [["workflow-history", "rma", rmaId]],
  });

  if (isLoading || !record) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const isAdmin = currentUser?.roleName === "admin" || currentUser?.roleName === "platform_admin";
  const department = currentUser?.department;
  // Notes and NCR/CAPA linkage — "quality can link NCR/CAPA, can add notes"
  // plus purchasing/material_management's "full RMA access".
  const canEditLinkage = isAdmin || department === "purchasing" || department === "material_management" || department === "quality";
  // Everything else (supplier, reason code, line items) — purchasing/material_management/admin only.
  const canEditFull = isAdmin || department === "purchasing" || department === "material_management";
  const nextActions = NEXT_STATUS[record.status] ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{record.rmaNumber}</h1>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge value={record.status} />
            <span className="text-sm text-muted-foreground">{record.reasonCode?.replace(/_/g, " ") ?? "No reason code set"}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {canEditFull && (
            <button onClick={() => setAddItemOpen(true)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              + Add Item
            </button>
          )}
          <CreateFeasibilityButton sourceType="rma" sourceId={record.id} defaultTitle={`Feasibility review for ${record.rmaNumber}`} defaultDepartment="purchasing" />
          <LinkSalesAccountButton sourceType="RMA" sourceId={record.id} defaultAccountName={record.rmaNumber} />
          <CreateCustomerButton sourceType="RMA" sourceId={record.id} defaultLegalName={record.rmaNumber} />
        </div>
      </div>

      {nextActions.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">Status</h3>
          <div className="flex flex-wrap gap-2">
            {nextActions.map((next) => {
              const allowed = isAdmin || (department != null && (TRANSITION_DEPARTMENTS[next.status] ?? []).includes(department));
              return (
                <WorkflowActionButton
                  key={next.status}
                  label={next.label}
                  navKey="rma"
                  action={statusAction}
                  onClick={() => statusAction.mutate({ id: rmaId, status: next.status })}
                  visible={allowed}
                />
              );
            })}
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-medium">Supplier</h3>
          {record.supplier ? (
            <div className="text-sm">
              <p className="font-medium">{record.supplier.name}</p>
              <p className="text-muted-foreground">{record.supplier.contactEmail ?? "No contact email on file"}</p>
              <p className="mt-1">
                <StatusBadge value={record.supplier.status} />
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Supplier not found.</p>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-medium">Linked NCR</h3>
          {canEditLinkage ? (
            <SelectField
              label=""
              value={record.linkedNcrId ?? ""}
              onChange={(e) => updateRma.mutate({ id: rmaId, linkedNcrId: e.target.value ? Number(e.target.value) : null } as never)}
            >
              <option value="">None</option>
              {ncrs.map((n) => (
                <option key={n.id} value={n.id}>
                  NCR #{n.id} — {n.title}
                </option>
              ))}
            </SelectField>
          ) : record.linkedNcr ? (
            <Link to={`/ncr/${record.linkedNcr.id}`} className="text-sm text-primary hover:underline">
              NCR #{record.linkedNcr.id} — {record.linkedNcr.title}
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">Not linked.</p>
          )}
          {record.linkedNcr && <p className="mt-1 text-xs text-muted-foreground">Status: {record.linkedNcr.status.replace(/_/g, " ")}</p>}
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-medium">Linked CAPA</h3>
          {canEditLinkage ? (
            <SelectField
              label=""
              value={record.linkedCapaId ?? ""}
              onChange={(e) => updateRma.mutate({ id: rmaId, linkedCapaId: e.target.value ? Number(e.target.value) : null } as never)}
            >
              <option value="">None</option>
              {capas.map((c) => (
                <option key={c.id} value={c.id}>
                  CAPA #{c.id}
                </option>
              ))}
            </SelectField>
          ) : record.linkedCapa ? (
            <Link to={`/capa/${record.linkedCapa.id}`} className="text-sm text-primary hover:underline">
              CAPA #{record.linkedCapa.id}
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">Not linked.</p>
          )}
          {record.linkedCapa && <p className="mt-1 text-xs text-muted-foreground">Status: {record.linkedCapa.status.replace(/_/g, " ")}</p>}
        </div>
      </div>

      {canEditFull && record.status === "draft" && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">Reason Code</h3>
          <SelectField label="" value={record.reasonCode ?? ""} onChange={(e) => updateRma.mutate({ id: rmaId, reasonCode: e.target.value || undefined } as never)}>
            <option value="">None</option>
            {REASON_CODES.map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, " ")}
              </option>
            ))}
          </SelectField>
          <p className="mt-2 text-xs text-muted-foreground">Only editable while the RMA is still a draft.</p>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-medium">Notes</h3>
        {canEditLinkage ? (
          editingNotes ? (
            <div className="flex flex-col gap-2">
              <TextAreaField label="" value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} />
              <div className="flex gap-2">
                <button
                  onClick={() => updateRma.mutate({ id: rmaId, notes: notesDraft } as never, { onSuccess: () => setEditingNotes(false) })}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                >
                  Save
                </button>
                <button onClick={() => setEditingNotes(false)} className="text-xs text-muted-foreground hover:underline">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                setNotesDraft(record.notes ?? "");
                setEditingNotes(true);
              }}
              className="text-left text-sm text-muted-foreground hover:underline"
            >
              {record.notes || "Add notes…"}
            </button>
          )
        ) : (
          <p className="text-sm text-muted-foreground">{record.notes || "No notes."}</p>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Returned Items</h3>
        {!record.items || record.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items added yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-2">Item</th>
                <th className="pb-2">Description</th>
                <th className="pb-2">Qty Returned</th>
                <th className="pb-2">Reason</th>
                <th className="pb-2">Supplier Response</th>
              </tr>
            </thead>
            <tbody>
              {record.items.map((item) => (
                <ItemRow key={item.id} item={item} rmaId={rmaId} canEdit={canEditFull} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <WorkflowHistoryPanel moduleName="rma" recordId={rmaId} />

      <AddItemModal rmaId={rmaId} isOpen={addItemOpen} onClose={() => setAddItemOpen(false)} />
    </div>
  );
}
