import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useCurrentUser } from "../../hooks/useAuth";
import { useWorkflowAccessLevel } from "../../hooks/useWorkflowAccess";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage, extractErrorMessageAsync } from "../../hooks/useWorkflowAction";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { TrendLineChart } from "../../components/charts/TrendLineChart";
import { Modal } from "../../components/modals/Modal";
import { TextField, TextAreaField } from "../../components/forms/Field";
import type { SupplierQualityFactors, SupplierRiskScoreWithTrend } from "../../api/types";

interface ScorecardEntry {
  id: number;
  period: string | null;
  qualityScore: string | null;
  deliveryScore: string | null;
  overallScore: string | null;
  notes: string | null;
  createdAt: string;
}

/**
 * Phase 7 task 6 — the consolidated Supplier Scorecard: the Quality Risk
 * Score + its trend + KPIs + open actions + health indicators (all from
 * supplier.qualityRisk.ts) alongside the pre-existing manually-entered
 * supplierScorecards table below — two genuinely different things kept
 * side by side rather than merged, since one is auto-computed from real
 * NCR/CAPA/RMA/warranty/delivery/communication data and the other is a
 * human-typed period rating, and merging them would silently discard
 * whichever one lost.
 *
 * The manually-entered side had a real backend write path
 * (POST /suppliers/:id/scorecard, added in Phase 7) but no UI ever called
 * it — this component only ever rendered the history table read-only. The
 * entry form below closes that gap in the one place this component is
 * already mounted for a specific supplier: the Supplier Portal's own
 * "Scorecard" tab when internal staff have picked a supplier (see
 * SupplierPortalHome.tsx's picker) — not a new page, not a second scorecard
 * concept.
 */
export function SupplierScorecard({ supplierId }: { supplierId?: number }) {
  const toast = useToast();
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();
  const isSupplier = currentUser?.roleName === "supplier";
  const canRecompute = !isSupplier && supplierId !== undefined;
  // The real gate the backend enforces on POST /suppliers/:id/scorecard is
  // requireDepartmentAccess("suppliers") at edit level — Quality/admin only
  // (Purchasing/Material Mgmt/Production are read-only on suppliers, see
  // supplier.routes.ts's own comment). Checked live via the same
  // DB-backed hook every other module's write-action gating already uses,
  // rather than the looser isReviewer flag SupplierPortalHome.tsx passes to
  // sibling panels (that one also admits Purchasing, which would show this
  // button to someone who'd then get a real 403 on submit).
  const suppliersAccessLevel = useWorkflowAccessLevel("suppliers");
  const canAddScorecard = !isSupplier && supplierId !== undefined && suppliersAccessLevel === "edit";
  const [addOpen, setAddOpen] = useState(false);

  const riskQueryKey = ["supplier-portal/risk-score", supplierId ?? "self"];
  const { data: risk, isLoading: riskLoading } = useQuery<SupplierRiskScoreWithTrend>({
    queryKey: riskQueryKey,
    queryFn: async () => (await apiClient.get("/supplier-portal/risk-score", { params: supplierId ? { supplierId } : undefined })).data,
  });
  const { data: kpis } = useQuery<SupplierQualityFactors>({
    queryKey: ["supplier-portal/kpis", supplierId ?? "self"],
    queryFn: async () => (await apiClient.get("/supplier-portal/kpis", { params: supplierId ? { supplierId } : undefined })).data,
  });
  const scorecardQueryKey = ["supplier-portal/scorecard", supplierId ?? "self"];
  const { data: rows = [], isLoading } = useQuery<ScorecardEntry[]>({
    queryKey: scorecardQueryKey,
    queryFn: async () => (await apiClient.get("/supplier-portal/scorecard", { params: supplierId ? { supplierId } : undefined })).data,
  });

  const recompute = useMutation({
    mutationFn: async () => (await apiClient.post(`/suppliers/${supplierId}/risk-score/recompute`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: riskQueryKey });
      toast.success("Quality Risk Score recomputed.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't recompute the risk score.")),
  });

  // The real write path (POST /suppliers/:id/scorecard, not a
  // /supplier-portal route — scorecard reads go through the portal's own
  // read-only mirror, but writing one is a Suppliers-module action, same
  // router the approve/suspend/portal-account actions already use).
  const addScorecard = useMutation({
    mutationFn: async (payload: { period: string; qualityScore?: number; deliveryScore?: number; notes?: string }) => (await apiClient.post(`/suppliers/${supplierId}/scorecard`, payload)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scorecardQueryKey });
      toast.success("Scorecard entry added.");
      setAddOpen(false);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't add this scorecard entry.")),
  });

  async function exportAs(format: "csv" | "pdf") {
    try {
      const res = await apiClient.get("/supplier-portal/scorecard/export", { params: { format, ...(supplierId ? { supplierId } : {}) }, responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `supplier-scorecard.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(await extractErrorMessageAsync(err, "Couldn't export the scorecard."));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Supplier Quality Risk Score</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => exportAs("csv")} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
              CSV
            </button>
            <button onClick={() => exportAs("pdf")} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
              PDF
            </button>
            {canRecompute && (
              <button onClick={() => recompute.mutate()} disabled={recompute.isPending} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60">
                {recompute.isPending ? "Recomputing…" : "Recompute"}
              </button>
            )}
          </div>
        </div>
        {riskLoading || !risk ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3">
              <p className="text-3xl font-semibold tabular-nums">{risk.latest.score}</p>
              <StatusBadge value={risk.latest.band === "high" || risk.latest.band === "critical" ? "critical" : risk.latest.band} label={`${risk.latest.band} risk`} />
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              A deterministic weighted formula over NCRs, CAPAs, CAPA recurrence, delivery performance, defect rate, warranty claims, and communication responsiveness — not the AI-based risk scorer on the Suppliers module (that's a separate, LLM-driven concept). Configurable in Settings → Supplier Risk.
            </p>
            {risk.trend.length > 1 && <TrendLineChart data={risk.trend.map((t) => ({ month: t.scoreDate, count: Number(t.score) }))} label="Risk Score" />}
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  ["NCR", risk.latest.breakdown.ncrFactor],
                  ["CAPA", risk.latest.breakdown.capaFactor],
                  ["Recurrence", risk.latest.breakdown.capaRecurrenceFactor],
                  ["Delivery", risk.latest.breakdown.deliveryFactor],
                  ["Defect Rate", risk.latest.breakdown.defectRateFactor],
                  ["Warranty", risk.latest.breakdown.warrantyFactor],
                  ["Responsiveness", risk.latest.breakdown.responsivenessFactor],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-md border border-border p-2 text-center">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-sm font-medium tabular-nums">{Math.round(value * 100)}%</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {kpis && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">Open Actions & Activity</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <dt className="text-muted-foreground">Open Corrective Actions</dt>
            <dd className="tabular-nums">{kpis.openCorrectiveActionCount}</dd>
            <dt className="text-muted-foreground">RMAs</dt>
            <dd className="tabular-nums">{kpis.rmaCount}</dd>
            <dt className="text-muted-foreground">Warranty Claims</dt>
            <dd className="tabular-nums">{kpis.warrantyClaimCount}</dd>
            <dt className="text-muted-foreground">SCARs</dt>
            <dd className="tabular-nums">{kpis.scarCount}</dd>
          </dl>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium">Manually Entered Scorecard History</h3>
          {canAddScorecard && (
            <button onClick={() => setAddOpen(true)} className="rounded-md border border-primary px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10">
              + Add Scorecard Entry
            </button>
          )}
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No scorecard entries recorded yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-2">Period</th>
                <th className="pb-2">Quality</th>
                <th className="pb-2">Delivery</th>
                <th className="pb-2">Overall</th>
                <th className="pb-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-1.5 font-medium">{r.period ?? "—"}</td>
                  <td className="py-1.5 tabular-nums">{r.qualityScore ?? "—"}</td>
                  <td className="py-1.5 tabular-nums">{r.deliveryScore ?? "—"}</td>
                  <td className="py-1.5 tabular-nums font-medium">{r.overallScore ?? "—"}</td>
                  <td className="py-1.5 text-muted-foreground">{r.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canAddScorecard && (
        <AddScorecardModal
          isOpen={addOpen}
          onClose={() => setAddOpen(false)}
          onSubmit={(values) => addScorecard.mutate(values)}
          isSubmitting={addScorecard.isPending}
        />
      )}
    </div>
  );
}

function AddScorecardModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (values: { period: string; qualityScore?: number; deliveryScore?: number; notes?: string }) => void;
  isSubmitting: boolean;
}) {
  const [period, setPeriod] = useState("");
  const [qualityScore, setQualityScore] = useState("");
  const [deliveryScore, setDeliveryScore] = useState("");
  const [notes, setNotes] = useState("");

  function reset() {
    setPeriod("");
    setQualityScore("");
    setDeliveryScore("");
    setNotes("");
  }

  return (
    <Modal
      title="Add Scorecard Entry"
      isOpen={isOpen}
      onClose={() => {
        reset();
        onClose();
      }}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            period,
            qualityScore: qualityScore === "" ? undefined : Number(qualityScore),
            deliveryScore: deliveryScore === "" ? undefined : Number(deliveryScore),
            notes: notes || undefined,
          });
          reset();
        }}
      >
        <TextField label="Period (e.g. 2026-Q1)" value={period} onChange={(e) => setPeriod(e.target.value)} required />
        <TextField label="Quality Score (0-100)" type="number" min={0} max={100} value={qualityScore} onChange={(e) => setQualityScore(e.target.value)} />
        <TextField label="Delivery Score (0-100)" type="number" min={0} max={100} value={deliveryScore} onChange={(e) => setDeliveryScore(e.target.value)} />
        <TextAreaField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        <p className="text-xs text-muted-foreground">Overall score is computed automatically as the average of Quality and Delivery.</p>
        <button type="submit" disabled={isSubmitting || !period} className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {isSubmitting ? "Saving…" : "Add Entry"}
        </button>
      </form>
    </Modal>
  );
}
