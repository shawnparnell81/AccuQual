import type { ReactNode } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { StatusBadge } from "../../components/tables/StatusBadge";
import type { InventoryLotTraceability, InventoryMovement } from "../../api/types";

function useLotTrace(lotId: number | undefined) {
  return useQuery<InventoryLotTraceability>({
    queryKey: ["inventory/lots/trace", lotId],
    queryFn: async () => (await apiClient.get(`/inventory/lots/${lotId}/trace`)).data,
    enabled: lotId !== undefined,
  });
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value ?? "—"}</dd>
    </div>
  );
}

function Section({ title, children, emptyMessage }: { title: string; children: ReactNode; emptyMessage?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium">{title}</h3>
      {emptyMessage ? <p className="text-sm text-muted-foreground">{emptyMessage}</p> : children}
    </div>
  );
}

/**
 * The frontend consumer this app's Phase 8 lot ledger never got — a lot's
 * own full backward-forward traceability chain (GET /inventory/lots/:id/
 * trace, built at that time but never wired to a page). Read-only by
 * design, same as every other traceability/history view in this app
 * (WorkflowHistoryPanel, the Movement Ledger below) — this isn't a place to
 * edit the lot, item, PO, or inspection report, each of which already has
 * its own real edit surface linked from here.
 */
export function InventoryLotDetailPage() {
  const { id } = useParams();
  const lotId = id ? Number(id) : undefined;
  const { data, isLoading } = useLotTrace(lotId);

  if (isLoading || !data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const { lot, item, supplier, receivingLineItem, poLineItem, purchaseOrder, inspectionReport, movements } = data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to={`/inventory/${item.id}`} className="text-xs text-primary hover:underline">
            ← {item.sku}
          </Link>
          <h1 className="text-2xl font-semibold">
            Lot {lot.lotNumber}
            {lot.serialNumber && <span className="text-muted-foreground"> / SN {lot.serialNumber}</span>}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <Link to={`/inventory/lots/${lot.id}/label`} className="text-sm text-primary hover:underline">
            Print label
          </Link>
          <StatusBadge value={lot.status} />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Lot Summary</h3>
        <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="Item" value={`${item.sku} — ${item.description ?? "—"}`} />
          <Field label="Received Qty" value={lot.receivedQty} />
          <Field label="Remaining Qty" value={lot.remainingQty} />
          {Number(lot.heldQty) > 0 && <Field label="On quarantine hold" value={`${lot.heldQty} (usable: ${Math.max(Number(lot.remainingQty) - Number(lot.heldQty), 0)})`} />}
          <Field label="Revision Level" value={lot.revisionLevel} />
          <Field label="Expiration Date" value={lot.expirationDate ? new Date(lot.expirationDate).toLocaleDateString() : null} />
          <Field label="Received On" value={new Date(lot.createdAt).toLocaleDateString()} />
        </dl>
      </div>

      <Section title="Supplier" emptyMessage={supplier ? undefined : "No supplier recorded for this lot."}>
        {supplier && (
          <dl className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Name"
              value={
                <Link to={`/suppliers/${supplier.id}`} className="text-primary hover:underline">
                  {supplier.name}
                </Link>
              }
            />
          </dl>
        )}
      </Section>

      <Section title="Purchase Order" emptyMessage={purchaseOrder ? undefined : "This lot isn't linked to a Purchase Order — it was likely entered manually, not through a Receiving Document."}>
        {purchaseOrder && (
          <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <Field
              label="PO #"
              value={
                <Link to={`/erp/${purchaseOrder.id}`} className="text-primary hover:underline">
                  PO #{purchaseOrder.id}
                </Link>
              }
            />
            <Field label="PO Status" value={<StatusBadge value={purchaseOrder.status} />} />
            <Field label="Ordered On" value={new Date(purchaseOrder.createdAt).toLocaleDateString()} />
            <Field label="Expected Delivery" value={purchaseOrder.expectedDeliveryDate ? new Date(purchaseOrder.expectedDeliveryDate).toLocaleDateString() : null} />
            {poLineItem && <Field label="PO Line Qty" value={poLineItem.quantity} />}
          </dl>
        )}
      </Section>

      <Section title="Receiving" emptyMessage={receivingLineItem ? undefined : "This lot isn't linked to a Receiving Document — it was likely entered manually."}>
        {receivingLineItem && (
          <dl className="grid gap-4 sm:grid-cols-3">
            <Field label="Receiving Line #" value={receivingLineItem.id} />
            <Field label="Qty Received" value={receivingLineItem.quantityReceived} />
            <Field label="Status" value={<StatusBadge value={receivingLineItem.status} />} />
          </dl>
        )}
      </Section>

      <Section title="Inspection Report" emptyMessage={inspectionReport ? undefined : "No inspection report has been filed against this lot's receiving line yet."}>
        {inspectionReport && (
          <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <Field
              label="Report"
              value={
                <Link to={`/quality-inspection-reports/${inspectionReport.id}`} className="text-primary hover:underline">
                  Report #{inspectionReport.id}
                </Link>
              }
            />
            <Field label="Inspection Type" value={inspectionReport.inspectionType} />
            <Field label="Final Status" value={<StatusBadge value={inspectionReport.finalStatus} />} />
            <Field label="Inspected On" value={inspectionReport.inspectionDate ? new Date(inspectionReport.inspectionDate).toLocaleDateString() : null} />
          </dl>
        )}
      </Section>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Movement History</h3>
        {movements.length === 0 ? (
          <p className="text-sm text-muted-foreground">No movements recorded against this lot yet.</p>
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
              </tr>
            </thead>
            <tbody>
              {movements.map((m: InventoryMovement) => (
                <tr key={m.id} className="border-t border-border">
                  <td className="py-1.5 text-muted-foreground">{new Date(m.performedAt).toLocaleString()}</td>
                  <td className="py-1.5 capitalize">{m.movementType}</td>
                  <td className="py-1.5 tabular-nums">{m.quantity}</td>
                  <td className="py-1.5 text-muted-foreground">{m.fromLocation ?? "—"}</td>
                  <td className="py-1.5 text-muted-foreground">{m.toLocation ?? "—"}</td>
                  <td className="py-1.5 text-muted-foreground">{m.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
