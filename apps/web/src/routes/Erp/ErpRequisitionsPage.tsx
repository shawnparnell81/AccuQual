import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useCanEditWorkflow } from "../../hooks/useWorkflowAccess";
import { DataTable } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { Modal } from "../../components/modals/Modal";
import { SelectField, TextField, TextAreaField } from "../../components/forms/Field";
import type { ErpPurchaseRequisition, InventoryItem, Supplier } from "../../api/types";

const requisitionHooks = createResourceHooks<ErpPurchaseRequisition>("erp/requisitions");
const itemHooks = createResourceHooks<InventoryItem>("inventory/items");
const supplierHooks = createResourceHooks<Supplier>("suppliers");

/**
 * Any requesting department can raise one (see departmentAccess.ts's
 * PERMISSION_MATRIX.purchase_requisitions) — not gated behind
 * useCanEditWorkflow("purchase_requisitions") since that's already true for
 * production/material_management/quality/engineering/purchasing alike; the
 * "+ New" button just always shows on this page.
 */
function NewRequisitionModal({ isOpen, onClose, onCreated }: { isOpen: boolean; onClose: () => void; onCreated: (r: ErpPurchaseRequisition) => void }) {
  const toast = useToast();
  const { data: items = [] } = itemHooks.useList();
  const { data: suppliers = [] } = supplierHooks.useList();
  const createReq = requisitionHooks.useCreate();
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [justification, setJustification] = useState("");

  return (
    <Modal title="New Purchase Requisition" isOpen={isOpen} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          createReq.mutate(
            {
              itemId: Number(itemId),
              quantity: Number(quantity),
              supplierId: supplierId ? Number(supplierId) : undefined,
              justification: justification || undefined,
            } as never,
            {
              onSuccess: (created) => {
                toast.success(`Requisition #${created.id} created.`);
                onClose();
                onCreated(created);
              },
              onError: (err) => toast.error(extractErrorMessage(err, "Couldn't create requisition.")),
            }
          );
        }}
      >
        <SelectField label="Item" required value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">Select an item…</option>
          {items.map((it) => (
            <option key={it.id} value={it.id}>
              {it.sku} {it.description ? `— ${it.description}` : ""}
            </option>
          ))}
        </SelectField>
        <TextField label="Quantity" type="number" min="0" step="1" required value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <SelectField label="Supplier (optional — defaults to the item's default supplier)" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">Use item default</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <TextAreaField label="Justification (optional — or draft one with AI on the detail page)" value={justification} onChange={(e) => setJustification(e.target.value)} />
        <button
          type="submit"
          disabled={!itemId || !quantity || createReq.isPending}
          className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {createReq.isPending ? "Creating…" : "Create Requisition"}
        </button>
      </form>
    </Modal>
  );
}

export function ErpRequisitionsPage() {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [status, setStatus] = useState("");
  const { data: rows = [], isLoading, isError } = requisitionHooks.useList(status ? { status } : undefined);
  const canApprove = useCanEditWorkflow("erp");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Purchase Requisitions</h1>
          <p className="text-sm text-muted-foreground">The pre-approval request step before a Purchase Order. {canApprove ? "You can approve/reject/convert these to POs." : "Any department can raise one; purchasing approves."}</p>
        </div>
        <button onClick={() => setCreateOpen(true)} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
          + New Requisition
        </button>
      </div>

      <div className="grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-4">
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          <option value="draft">Draft</option>
          <option value="pending_approval">Pending Approval</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="converted_to_po">Converted to PO</option>
        </SelectField>
      </div>

      <DataTable<ErpPurchaseRequisition>
        columns={[
          { header: "ID", accessor: (r) => `#${r.id}` },
          { header: "Item", accessor: (r) => r.sku ?? `Item #${r.itemId}` },
          { header: "Qty", accessor: (r) => r.quantity },
          { header: "Department", accessor: (r) => r.department ?? "—" },
          { header: "Status", accessor: (r) => <StatusBadge value={r.status} /> },
          { header: "Justification", accessor: (r) => (r.justification ? r.justification.slice(0, 60) + (r.justification.length > 60 ? "…" : "") : "—") },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        isError={isError}
        onRowClick={(r) => navigate(`/erp/requisitions/${r.id}`)}
        emptyMessage="No purchase requisitions yet."
      />

      <NewRequisitionModal isOpen={createOpen} onClose={() => setCreateOpen(false)} onCreated={(created) => navigate(`/erp/requisitions/${created.id}`)} />
    </div>
  );
}
