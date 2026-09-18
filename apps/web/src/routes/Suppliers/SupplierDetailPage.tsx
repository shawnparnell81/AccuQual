import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { useWorkflowAction, extractErrorMessage } from "../../hooks/useWorkflowAction";
import { apiClient } from "../../api/client";
import type { Supplier, SupplierPerformance, CostingSummary, SupplierQualityFactors, SupplierRiskScoreWithTrend } from "../../api/types";
import { TrendLineChart } from "../../components/charts/TrendLineChart";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { PrintFormButton } from "../../components/forms/PrintFormButton";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { AiFieldAssistant } from "../../components/shared/AiFieldAssistant";
import { CreateRiskButton } from "../../components/shared/CreateRiskButton";
import { CreateCustomerButton } from "../../components/shared/CreateCustomerButton";
import { useToast } from "../../components/shared/ToastProvider";
import { Modal } from "../../components/modals/Modal";
import { TextField } from "../../components/forms/Field";
import { useSetAssistantContext } from "../../hooks/useAssistantContext";

/**
 * Creates this supplier's Supplier Portal login (see
 * supplier.controller.ts's createPortalAccountHandler) — Quality/admin only,
 * matching the router's own gate. No SMTP is configured in this environment,
 * so the generated temporary password is shown once, right here, instead of
 * a fabricated "email sent" claim.
 */
function CreatePortalAccountButton({ supplierId }: { supplierId: number }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<{ email: string; temporaryPassword: string } | null>(null);

  const create = useMutation({
    mutationFn: async () => (await apiClient.post(`/suppliers/${supplierId}/portal-account`, { email })).data as { user: { email: string }; temporaryPassword: string },
    onSuccess: (data) => setResult({ email: data.user.email, temporaryPassword: data.temporaryPassword }),
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't create a Supplier Portal login.")),
  });

  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
        Create Portal Login
      </button>
      <Modal
        title="Supplier Portal Login"
        isOpen={open}
        onClose={() => {
          setOpen(false);
          setResult(null);
          setEmail("");
        }}
      >
        {result ? (
          <div className="flex flex-col gap-2 text-sm">
            <p>
              Login created for <strong>{result.email}</strong>. Share this temporary password with the supplier directly — it won't be
              shown again:
            </p>
            <p className="select-all rounded-md border border-border bg-muted p-2 font-mono text-sm">{result.temporaryPassword}</p>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <TextField label="Supplier's Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" disabled={create.isPending} className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {create.isPending ? "Creating…" : "Create Login"}
            </button>
          </form>
        )}
      </Modal>
    </>
  );
}

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
  const toast = useToast();
  const { data: supplier, isLoading, isError } = supplierHooks.useOne(supplierId);
  useSetAssistantContext("supplier", supplierId, supplier ? supplier.name : `Supplier #${supplierId}`);
  const { data: performance } = useSupplierPerformance(supplierId);
  const costing = useSupplierCosting(supplierId);
  const historyKey: unknown[][] = [["workflow-history", "suppliers", supplierId]];

  // Phase 7 — Supplier Quality Risk Score + KPIs (see supplier.qualityRisk.ts).
  const riskQueryKey = ["suppliers", supplierId, "risk-score"];
  const { data: riskScore, isLoading: riskLoading } = useQuery<SupplierRiskScoreWithTrend>({
    queryKey: riskQueryKey,
    queryFn: async () => (await apiClient.get(`/suppliers/${supplierId}/risk-score`)).data,
  });
  const { data: kpis } = useQuery<SupplierQualityFactors>({
    queryKey: ["suppliers", supplierId, "kpis"],
    queryFn: async () => (await apiClient.get(`/suppliers/${supplierId}/kpis`)).data,
  });
  const queryClient = useQueryClient();
  const recomputeRisk = useMutation({
    mutationFn: async () => (await apiClient.post(`/suppliers/${supplierId}/risk-score/recompute`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: riskQueryKey });
      toast.success("Quality Risk Score recomputed.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't recompute the risk score.")),
  });

  const approveAction = useWorkflowAction("suppliers", "approve", { successMessage: "Supplier approved.", invalidateKeys: historyKey });
  const conditionalAction = useWorkflowAction("suppliers", "conditional", { successMessage: "Supplier set to conditional.", invalidateKeys: historyKey });
  const suspendAction = useWorkflowAction("suppliers", "suspend", { successMessage: "Supplier suspended.", invalidateKeys: historyKey });
  const removeAction = useWorkflowAction("suppliers", "remove", { successMessage: "Supplier disqualified.", invalidateKeys: historyKey });

  if (isError) return <p className="text-sm text-destructive">Couldn't load this record — try refreshing the page.</p>;
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
            {/* This is the supplier's own manually-set risk rating column — a
                third, separate "risk" concept from the Risk Register (the
                "Create Risk" button here), AI Insights' supplier risk score,
                and the Digital Twin's simulation heatmap. Labeled explicitly
                so the two controls sitting right next to each other aren't
                confused for the same thing. */}
            <span title="This supplier's own manually-set rating — separate from the Risk Register below.">
              <StatusBadge value={supplier.riskLevel} label={`Supplier rating: ${supplier.riskLevel}`} />
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <OpenFormButton formType="supplier" entityId={supplier.id} title={`Supplier #${supplier.id} Record`} label="Supplier Record" />
          <PrintFormButton formType="supplier" entityId={supplier.id} />
          <OpenFormButton
            formType="approved_vendor_list"
            entityId={supplier.id}
            title={`Supplier #${supplier.id} — Approved Vendor List`}
            label="Approved Vendor List"
          />
          <CreateRiskButton sourceType="Supplier" sourceId={supplier.id} defaultTitle={`Risk from ${supplier.name}`} defaultDepartment="purchasing" defaultCategory="supplier" />
          <CreateCustomerButton sourceType="Supplier" sourceId={supplier.id} defaultLegalName={supplier.name} />
          <CreatePortalAccountButton supplierId={supplier.id} />
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
          <div className="flex items-center gap-2">
            {performance && performance.riskScore !== "no_data" && (
              <StatusBadge value={performance.riskScore === "high" ? "critical" : performance.riskScore} label={`Risk: ${performance.riskScore}`} />
            )}
            <AiFieldAssistant
              module="supplier_risk"
              recordId={supplierId}
              triggerLabel="AI Supplier Risk Prediction"
              buildInitialPrompt={() =>
                `Predict the ongoing risk for Supplier "${supplier.name}" using the metrics provided (delivery timeliness, delivery` +
                " accuracy, reorder responsiveness, below-min alert frequency, and cost impact). Respond with: a risk level (low/medium/" +
                "high), a reasoning summary explaining that level from the specific numbers given, and a few concrete recommended" +
                " mitigation actions. Note explicitly in your answer if any of the underlying metrics have too little data to be reliable."
              }
            />
          </div>
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
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">Quality Risk Score</h2>
          <button onClick={() => recomputeRisk.mutate()} disabled={recomputeRisk.isPending} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60">
            {recomputeRisk.isPending ? "Recomputing…" : "Recompute"}
          </button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          A deterministic weighted formula over NCRs, CAPAs, CAPA recurrence, delivery performance, defect rate, warranty claims, and communication responsiveness — a separate concept from the
          "AI Supplier Risk Prediction" above (that one is LLM-generated). Weights configurable in Settings → Supplier Risk.
        </p>
        {riskLoading || !riskScore ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3">
              <p className="text-3xl font-semibold tabular-nums">{riskScore.latest.score}</p>
              <StatusBadge value={riskScore.latest.band === "high" || riskScore.latest.band === "critical" ? "critical" : riskScore.latest.band} label={`${riskScore.latest.band} risk`} />
            </div>
            {riskScore.trend.length > 1 && <TrendLineChart data={riskScore.trend.map((t) => ({ month: t.scoreDate, count: Number(t.score) }))} label="Risk Score" />}
            {kpis && (
              <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
                <PerformanceStat label="NCR Count" value={String(kpis.ncrCount)} />
                <PerformanceStat label="CAPA Count" value={String(kpis.capaCount)} />
                <PerformanceStat label="Open Corrective Actions" value={String(kpis.openCorrectiveActionCount)} />
                <PerformanceStat label="Warranty Claims" value={String(kpis.warrantyClaimCount)} />
              </div>
            )}
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

      <AttachmentsPanel entityType="suppliers" entityId={supplierId} />
      <WorkflowHistoryPanel moduleName="suppliers" recordId={supplierId} />
    </div>
  );
}
