import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useCanEditWorkflow } from "../../hooks/useWorkflowAccess";
import { useToast } from "./ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { Modal } from "../modals/Modal";
import { TextField, TextAreaField } from "../forms/Field";
import type { CustomerScorecard, CustomerScorecardSummary } from "../../api/types";

/**
 * Customer Scorecard — same manually-entered period/quality/delivery/
 * overall/notes shape as SupplierScorecard.tsx's own history table, rating
 * OUR performance delivering to this customer instead of a supplier's
 * performance to us. Embedded directly on CustomerDetailPage.tsx (unlike
 * SupplierScorecard, which lives under SupplierPortal because it's shared
 * with an external supplier login — customers have no equivalent external
 * portal, so this is a plain shared panel like AttachmentsPanel/
 * CustomerCommunicationsPanel).
 *
 * Deliberately has no auto-computed "risk score" alongside it the way
 * suppliers get — see customerScorecards.ts's own schema comment on why
 * (only warranty/CRAR/feasibility carry a real customerId FK today; a
 * weighted formula would silently under-count complaints and the
 * customer-return register, which don't). The KPI row below surfaces those
 * three real counts as honest context instead.
 */
export function CustomerScorecardPanel({ customerId }: { customerId: number }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const canAdd = useCanEditWorkflow("customers");
  const [addOpen, setAddOpen] = useState(false);

  const { data: summary } = useQuery<CustomerScorecardSummary>({
    queryKey: ["customers/scorecard-summary", customerId],
    queryFn: async () => (await apiClient.get(`/customers/${customerId}/scorecard-summary`)).data,
  });

  const scorecardQueryKey = ["customers/scorecard", customerId];
  const { data: rows = [], isLoading } = useQuery<CustomerScorecard[]>({
    queryKey: scorecardQueryKey,
    queryFn: async () => (await apiClient.get(`/customers/${customerId}/scorecard`)).data,
  });

  const addScorecard = useMutation({
    mutationFn: async (payload: { period: string; qualityScore?: number; deliveryScore?: number; notes?: string }) => (await apiClient.post(`/customers/${customerId}/scorecard`, payload)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scorecardQueryKey });
      toast.success("Scorecard entry added.");
      setAddOpen(false);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't add this scorecard entry.")),
  });

  return (
    <div className="flex flex-col gap-4">
      {summary && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">Related Quality Activity</h3>
          <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Warranty Claims</dt>
            <dd className="tabular-nums">{summary.warrantyClaimCount}</dd>
            <dt className="text-muted-foreground">CRAR Reports</dt>
            <dd className="tabular-nums">{summary.crarCount}</dd>
            <dt className="text-muted-foreground">Feasibility Reviews</dt>
            <dd className="tabular-nums">{summary.feasibilityReviewCount}</dd>
          </dl>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium">Customer Scorecard</h3>
          {canAdd && (
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

      {canAdd && (
        <AddCustomerScorecardModal isOpen={addOpen} onClose={() => setAddOpen(false)} onSubmit={(values) => addScorecard.mutate(values)} isSubmitting={addScorecard.isPending} />
      )}
    </div>
  );
}

function AddCustomerScorecardModal({
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
