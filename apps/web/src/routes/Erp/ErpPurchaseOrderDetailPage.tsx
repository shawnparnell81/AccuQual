import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { useWorkflowAction } from "../../hooks/useWorkflowAction";
import { useCurrentUser } from "../../hooks/useAuth";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { Modal } from "../../components/modals/Modal";
import { TextField } from "../../components/forms/Field";
import { CreateRiskButton } from "../../components/shared/CreateRiskButton";
import { LinkSalesAccountButton } from "../../components/shared/LinkSalesAccountButton";
import { CreateCustomerButton } from "../../components/shared/CreateCustomerButton";
import type { ErpPurchaseOrder, ErpReceivingDocument, ErpReceivingLineItem, ReceivingLineItemStatus } from "../../api/types";

const poHooks = createResourceHooks<ErpPurchaseOrder>("erp/purchase-orders");

function useReceivingDocuments(purchaseOrderId: number | undefined) {
  return useQuery<ErpReceivingDocument[]>({
    queryKey: ["erp/receiving-documents", purchaseOrderId],
    queryFn: async () => (await apiClient.get("/erp/receiving-documents", { params: { purchaseOrderId } })).data,
    enabled: purchaseOrderId !== undefined,
  });
}

function LogReceiptModal({ po, isOpen, onClose }: { po: ErpPurchaseOrder; isOpen: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const lineItems = po.lineItems ?? [];
  const remaining = lineItems.map((li) => li.quantity - li.quantityReceived);
  const [quantities, setQuantities] = useState<string[]>(remaining.map((r) => String(Math.max(r, 0))));
  // Phase 8 — lot/serial/revision/expiration captured at the moment of
  // physical receipt, mirrored onto a real inventory_lots row server-side
  // (see erp.service.ts's createReceivingDocument).
  const [lotNumbers, setLotNumbers] = useState<string[]>(lineItems.map(() => ""));
  const [serialNumbers, setSerialNumbers] = useState<string[]>(lineItems.map(() => ""));
  const [revisionLevels, setRevisionLevels] = useState<string[]>(lineItems.map(() => ""));
  const [expirationDates, setExpirationDates] = useState<string[]>(lineItems.map(() => ""));
  const [notes, setNotes] = useState("");

  // POST /erp/receiving-documents doesn't fit useWorkflowAction's
  // /resource/:id/action shape (it's a plain create with purchaseOrderId in
  // the body), so this is its own small mutation, same as
  // RecheckMinMaxButton's check-minmax call.
  const createReceiving = useMutation({
    mutationFn: async (body: {
      purchaseOrderId: number;
      notes?: string;
      lineItems: { poLineItemId: number; quantityReceived: number; lotNumber?: string; serialNumber?: string; revisionLevel?: string; expirationDate?: string }[];
    }) => (await apiClient.post("/erp/receiving-documents", body)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["erp/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["erp/receiving-documents", po.id] });
      queryClient.invalidateQueries({ queryKey: ["workflow-history", "erp", po.id] });
      toast.success("Receiving document logged.");
      onClose();
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't log receipt.")),
  });

  return (
    <Modal title={`Log Receipt — PO #${po.id}`} isOpen={isOpen} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const receiptLines = lineItems
            .map((li, i) => ({
              poLineItemId: li.id,
              quantityReceived: Number(quantities[i] || 0),
              lotNumber: lotNumbers[i] || undefined,
              serialNumber: serialNumbers[i] || undefined,
              revisionLevel: revisionLevels[i] || undefined,
              expirationDate: expirationDates[i] || undefined,
            }))
            .filter((l) => l.quantityReceived > 0);
          if (receiptLines.length === 0) {
            toast.error("Enter a received quantity for at least one line.");
            return;
          }
          createReceiving.mutate({ purchaseOrderId: po.id, notes: notes || undefined, lineItems: receiptLines });
        }}
      >
        {lineItems.map((li, i) => (
          <div key={li.id} className="flex flex-col gap-2 border-b border-border pb-3 last:border-0">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">
                <p className="font-medium">{li.sku}</p>
                <p className="text-xs text-muted-foreground">
                  Ordered {li.quantity} · Received {li.quantityReceived} · Remaining {Math.max(li.quantity - li.quantityReceived, 0)}
                </p>
              </div>
              <input
                type="number"
                min="0"
                max={Math.max(li.quantity - li.quantityReceived, 0)}
                value={quantities[i]}
                onChange={(e) => setQuantities((q) => q.map((v, idx) => (idx === i ? e.target.value : v)))}
                className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <input
                placeholder="Lot #"
                value={lotNumbers[i]}
                onChange={(e) => setLotNumbers((q) => q.map((v, idx) => (idx === i ? e.target.value : v)))}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              />
              <input
                placeholder="Serial # (optional)"
                value={serialNumbers[i]}
                onChange={(e) => setSerialNumbers((q) => q.map((v, idx) => (idx === i ? e.target.value : v)))}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              />
              <input
                placeholder="Revision level"
                value={revisionLevels[i]}
                onChange={(e) => setRevisionLevels((q) => q.map((v, idx) => (idx === i ? e.target.value : v)))}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              />
              <input
                type="date"
                title="Expiration date"
                value={expirationDates[i]}
                onChange={(e) => setExpirationDates((q) => q.map((v, idx) => (idx === i ? e.target.value : v)))}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              />
            </div>
          </div>
        ))}
        <TextField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button type="submit" disabled={createReceiving.isPending} className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {createReceiving.isPending ? "Logging…" : "Log Receipt"}
        </button>
      </form>
    </Modal>
  );
}

// Phase 8 — mirrors receivingWorkflow.ts's RECEIVING_TRANSITIONS exactly
// (server is still the real gate; this is only for deciding which buttons
// to show).
const RECEIVING_TRANSITIONS: Record<ReceivingLineItemStatus, ReceivingLineItemStatus[]> = {
  received: ["pending_inspection"],
  pending_inspection: ["inspected"],
  inspected: ["accepted", "rejected", "quarantined", "disposition_required"],
  disposition_required: ["accepted", "rejected", "quarantined"],
  quarantined: ["accepted", "rejected"],
  accepted: [],
  rejected: [],
};
const TRANSITION_LABELS: Record<ReceivingLineItemStatus, string> = {
  received: "Received",
  pending_inspection: "Send to Inspection",
  inspected: "Mark Inspected",
  accepted: "Accept",
  rejected: "Reject",
  quarantined: "Quarantine",
  disposition_required: "Flag for Disposition",
};

/** Phase 8 — one receiving line item's structured status + the disposition transition buttons the current user's department can take, plus a shortcut into a real Quality Inspection Report pre-linked to this line/supplier. */
function ReceivingLineItemRow({ lineItem, po }: { lineItem: ErpReceivingLineItem; po: ErpPurchaseOrder }) {
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUser = useCurrentUser();
  const isQuality = currentUser?.department === "quality" || currentUser?.roleName === "admin" || currentUser?.roleName === "platform_admin";
  const isMaterialMgmt = currentUser?.department === "material_management" || currentUser?.roleName === "admin" || currentUser?.roleName === "platform_admin";

  const transition = useMutation({
    mutationFn: async (status: ReceivingLineItemStatus) => (await apiClient.post(`/erp/receiving-line-items/${lineItem.id}/status`, { status })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["erp/receiving-documents", po.id] });
      toast.success("Receiving line item updated.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update this receiving line item.")),
  });

  const createInspection = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post("/quality-inspection-reports", {
          inspectionType: "incoming",
          supplierId: po.supplierId,
          receivingLineItemId: lineItem.id,
        })
      ).data,
    onSuccess: (created: { id: number }) => navigate(`/quality-inspection-reports/${created.id}`),
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't create an inspection report.")),
  });

  const nextStates = RECEIVING_TRANSITIONS[lineItem.status] ?? [];
  const qualityOwned = new Set(["inspected", "accepted", "rejected", "quarantined", "disposition_required"]);

  return (
    <div className="ml-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 p-2 text-xs">
      <StatusBadge value={lineItem.status === "rejected" || lineItem.status === "quarantined" ? "critical" : lineItem.status} label={lineItem.status.replace(/_/g, " ")} />
      <span className="text-muted-foreground">Qty {lineItem.quantityReceived}</span>
      {lineItem.lotNumber && <span className="text-muted-foreground">Lot {lineItem.lotNumber}</span>}
      {lineItem.serialNumber && <span className="text-muted-foreground">S/N {lineItem.serialNumber}</span>}
      <div className="ml-auto flex flex-wrap gap-1.5">
        {nextStates.map((target) => {
          const allowed = qualityOwned.has(target) ? isQuality : isMaterialMgmt || isQuality;
          if (!allowed) return null;
          return (
            <button
              key={target}
              onClick={() => transition.mutate(target)}
              disabled={transition.isPending}
              className="rounded-md border border-border bg-background px-2 py-1 hover:bg-muted disabled:opacity-50"
            >
              {TRANSITION_LABELS[target]}
            </button>
          );
        })}
        {isQuality && (lineItem.status === "pending_inspection" || lineItem.status === "inspected") && (
          <button onClick={() => createInspection.mutate()} disabled={createInspection.isPending} className="rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground disabled:opacity-50">
            {createInspection.isPending ? "Creating…" : "Create Inspection Report"}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Real PO + line items (sku/description live-joined from inventory_items,
 * quantityReceived a real sum over every receiving document — never
 * denormalized), Purchasing's send/cancel actions, and material_management's
 * receiving flow. No inventory_movement is ever created from here — see
 * the ERP module review; this is real paperwork, not a live inventory sync.
 */
export function ErpPurchaseOrderDetailPage() {
  const { id } = useParams();
  const poId = Number(id);
  const { data: po, isLoading, isError } = poHooks.useOne(poId);
  const { data: receivingDocs = [] } = useReceivingDocuments(poId);
  const currentUser = useCurrentUser();
  const canReceive = currentUser?.roleName === "admin" || currentUser?.roleName === "platform_admin" || currentUser?.department === "material_management";
  const [receiptOpen, setReceiptOpen] = useState(false);
  const historyKey: unknown[][] = [["workflow-history", "erp", poId]];

  const sendAction = useWorkflowAction("erp/purchase-orders", "send", { successMessage: "Purchase order sent.", invalidateKeys: historyKey });
  const cancelAction = useWorkflowAction("erp/purchase-orders", "cancel", { successMessage: "Purchase order cancelled.", invalidateKeys: historyKey });

  if (isError) return <p className="text-sm text-destructive">Couldn't load this record — try refreshing the page.</p>;
  if (isLoading || !po) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const canCancel = po.status !== "received" && po.status !== "cancelled";
  const canSend = po.status === "draft";
  const canLogReceipt = po.status === "sent" || po.status === "partially_received";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">Purchase Order #{po.id}</h1>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge value={po.status} />
            <span className="text-sm text-muted-foreground">{po.supplierName}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => window.print()} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Print
          </button>
          <WorkflowActionButton label="Send" navKey="erp" action={sendAction} onClick={() => sendAction.mutate({ id: poId })} visible={canSend} variant="primary" />
          {canReceive && canLogReceipt && (
            <button onClick={() => setReceiptOpen(true)} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
              Log Receipt
            </button>
          )}
          <WorkflowActionButton label="Cancel" navKey="erp" action={cancelAction} onClick={() => cancelAction.mutate({ id: poId })} visible={canCancel} />
          <LinkSalesAccountButton sourceType="PO" sourceId={po.id} defaultAccountName={po.supplierName ?? `PO #${po.id}`} />
          <CreateCustomerButton sourceType="PO" sourceId={po.id} defaultLegalName={po.supplierName ?? `PO #${po.id}`} />
        </div>
      </div>

      <div className="hidden print:block">
        <h1 className="text-2xl font-semibold">Purchase Order #{po.id}</h1>
        <p className="text-sm text-muted-foreground">Status: {po.status.replace(/_/g, " ")} — {po.supplierName}</p>
      </div>

      {po.notes && <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">{po.notes}</div>}

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Line Items</h3>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="pb-2">SKU</th>
              <th className="pb-2">Description</th>
              <th className="pb-2">Ordered</th>
              <th className="pb-2">Received</th>
              <th className="pb-2">Unit Cost</th>
              <th className="pb-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {(po.lineItems ?? []).map((li) => (
              <tr key={li.id} className="border-t border-border">
                <td className="py-1.5 font-medium">{li.sku}</td>
                <td className="py-1.5 text-muted-foreground">{li.description ?? "—"}</td>
                <td className="py-1.5">{li.quantity}</td>
                <td className="py-1.5">
                  {li.quantityReceived}
                  {li.quantityReceived >= li.quantity ? "" : ` / ${li.quantity}`}
                </td>
                <td className="py-1.5">{li.unitCost !== null ? `$${Number(li.unitCost).toFixed(2)}` : "—"}</td>
                <td className="py-1.5 text-muted-foreground">{li.notes ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Receiving Documents</h3>
        {receivingDocs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing received yet.</p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {receivingDocs.map((doc) => (
              <li key={doc.id} className="flex flex-col gap-2 border-b border-border pb-3 last:border-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">Receipt #{doc.id}</span>
                  <span className="text-muted-foreground">{new Date(doc.createdAt).toLocaleString()}</span>
                  {doc.notes && <span className="text-muted-foreground">{doc.notes}</span>}
                  <CreateRiskButton
                    sourceType="Receiving"
                    sourceId={doc.id}
                    defaultTitle={`Risk from Receipt #${doc.id} (PO #${po.id})`}
                    defaultDepartment="material_management"
                    defaultCategory="supplier"
                    label="Create Risk"
                  />
                </div>
                {(doc.lineItems ?? []).map((li) => (
                  <ReceivingLineItemRow key={li.id} lineItem={li} po={po} />
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-4 print:hidden">
        <AttachmentsPanel entityType="erp_po" entityId={poId} />
        <WorkflowHistoryPanel moduleName="erp" recordId={poId} />
      </div>

      <LogReceiptModal po={po} isOpen={receiptOpen} onClose={() => setReceiptOpen(false)} />
    </div>
  );
}
