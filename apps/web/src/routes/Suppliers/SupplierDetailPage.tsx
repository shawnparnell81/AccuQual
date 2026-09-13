import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { useWorkflowAction } from "../../hooks/useWorkflowAction";
import { apiClient } from "../../api/client";
import type { Supplier, SupplierPerformance, CostingSummary } from "../../api/types";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";

const supplierHooks = createResourceHooks<Supplier>("suppliers");

function useSupplierPerformance(supplierId: number | undefined) {
  return useQuery<SupplierPerformance>({
    queryKey: ["suppliers", supplierId, "performance"],
    queryFn: async () => (await apiClient.get(`/suppliers/${supplierId}/performance`)).data,
    enabled: supplierId !== undefined,
  });
}

/** No dedicated /suppliers/:id/costing endpoint — the reviewed prompt's own deliverable list named exactly two costing endpoints, both under /inventory/costing. This reads the tenant-wide summary and picks out this supplier's entry, same as the Dashboard's Supplier Cost Distribution chart does. */
function useSupplierCosting(supplierId: number | undefined) {
  const query = useQuery<CostingSummary>({
    queryKey: ["inventory/costing/summary"],
    queryFn: async () => (await apiClient.get("/inventory/costing/summary", { params: { days: 30 } })).data,
  });
  const entry = query.data?.supplierCostDistribution.find((s) => s.supplierId === supplierId);
  return { entry, days: query.data?.days, isLoading: query.isLoading };
}

function PerformanceStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/**
 * Supplier detail: the roster record plus its fillable supplier record and
 * Approved Vendor List entry, plus the 4 dedicated status-change actions
 * added in Phase 6 (approve/conditional/suspend/remove) — this page had
 * zero of them before, only the read-only status badges.
 */
export function SupplierDetailPage() {
  const { id } = useParams();
  const supplierId = Number(id);
  const { data: supplier, isLoading } = supplierHooks.useOne(supplierId);
  const { data: performance } = useSupplierPerformance(supplierId);
  const costing = useSupplierCosting(supplierId);
  const historyKey: unknown[][] = [["workflow-history", "suppliers", supplierId]];

  const approveAction = useWorkflowAction("suppliers", "approve", { successMessage: "Supplier approved.", invalidateKeys: historyKey });
  const conditionalAction = useWorkflowAction("suppliers", "conditional", { successMessage: "Supplier set to conditional.", invalidateKeys: historyKey });
  const suspendAction = useWorkflowAction("suppliers", "suspend", { successMessage: "Supplier suspended.", invalidateKeys: historyKey });
  const removeAction = useWorkflowAction("suppliers", "remove", { successMessage: "Supplier disqualified.", invalidateKeys: historyKey });

  if (isLoading || !supplier) return <p className="text-sm text-muted-foreground">Loading…</p>;

  // Disqualification is terminal on the backend (supplier.controller.ts) —
  // every other action 400s once here, so none of them are worth showing.
  const isTerminal = supplier.status === "disqualified";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{supplier.name}</h1>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge value={supplier.status} />
            <StatusBadge value={supplier.riskLevel} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <OpenFormButton formType="supplier" entityId={supplier.id} title={`Supplier #${supplier.id} Record`} label="Supplier Record" />
          <OpenFormButton
            formType="approved_vendor_list"
            entityId={supplier.id}
            title={`Supplier #${supplier.id} — Approved Vendor List`}
            label="Approved Vendor List"
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Contact: {supplier.contactEmail ?? "—"}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Status</h2>
        {isTerminal ? (
          <p className="text-sm text-muted-foreground">Disqualified — this is a terminal state; no further status changes apply.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <WorkflowActionButton
              label="Approve"
              navKey="suppliers"
              action={approveAction}
              onClick={() => approveAction.mutate({ id: supplierId })}
              visible={supplier.status !== "active"}
              variant="primary"
            />
            <WorkflowActionButton
              label="Set Conditional"
              navKey="suppliers"
              action={conditionalAction}
              onClick={() => conditionalAction.mutate({ id: supplierId })}
              visible={supplier.status !== "probation"}
            />
            <WorkflowActionButton
              label="Suspend"
              navKey="suppliers"
              action={suspendAction}
              onClick={() => suspendAction.mutate({ id: supplierId })}
              visible={supplier.status !== "suspended"}
            />
            <WorkflowActionButton label="Disqualify" navKey="suppliers" action={removeAction} onClick={() => removeAction.mutate({ id: supplierId })} />
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">Performance Analytics</h2>
          {performance && performance.riskScore !== "no_data" && (
            <StatusBadge value={performance.riskScore === "high" ? "critical" : performance.riskScore} label={`Risk: ${performance.riskScore}`} />
          )}
        </div>
        {!performance ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : performance.itemCount === 0 ? (
          <p className="text-sm text-muted-foreground">
            No inventory items are linked to this supplier yet — set it as an item's supplier from that item's detail page to start
            tracking performance.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <PerformanceStat label="Avg Delivery Time" value={performance.deliveryTimeliness.avgDays === null ? "No data" : `${performance.deliveryTimeliness.avgDays}d`} />
              <PerformanceStat label="Delivery Accuracy" value={performance.deliveryAccuracy.avgPercent === null ? "No data" : `${performance.deliveryAccuracy.avgPercent}%`} />
              <PerformanceStat label={`Deliveries (${performance.deliveryFrequency.days}d)`} value={String(performance.deliveryFrequency.count)} />
              <PerformanceStat label="Pending Reorder Requests" value={String(performance.reorderResponsiveness.overduePendingCount)} />
              <PerformanceStat label="Below-Min Alerts" value={String(performance.belowMinAlertCount)} />
              <PerformanceStat label="Linked Items" value={String(performance.itemCount)} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Delivery time/accuracy are computed from real receive movements matched to sent reorder requests (sample size:{" "}
              {performance.deliveryTimeliness.sampleSize}) — nothing formally links a request to the delivery that fulfills it, so this
              is a best-effort pairing, not a guarantee.
            </p>
          </>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Costing</h2>
        {costing.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !costing.entry ? (
          <p className="text-sm text-muted-foreground">
            No costed, linked inventory items yet — link an item to this supplier and set its unit cost from that item's detail page.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <PerformanceStat label="Inventory Value" value={`$${costing.entry.itemValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
              <PerformanceStat label={`Scrap Cost (${costing.days}d)`} value={`$${costing.entry.scrapCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
              <PerformanceStat
                label={`Consumption Cost (${costing.days}d)`}
                value={`$${costing.entry.consumptionCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Based on {costing.entry.itemCount} linked item{costing.entry.itemCount === 1 ? "" : "s"} with a unit cost set — items with
              no cost don't contribute here. Today's cost applied to past movements, not the actual cost paid at the time (no FIFO/LIFO
              history exists).
            </p>
          </>
        )}
      </div>

      <WorkflowHistoryPanel moduleName="suppliers" recordId={supplierId} />
    </div>
  );
}
