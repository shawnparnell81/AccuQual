import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { SelectField, TextField } from "../../components/forms/Field";
import type { WarrantyClaimCost, WarrantyCostType } from "../../api/types";

const COST_TYPES: WarrantyCostType[] = ["parts", "labor", "shipping", "replacement_unit", "other"];

/** Real cost entries + a running actual-cost total (recomputed server-side on every insert — see warranty.controller.ts's createWarrantyCostHandler). canEdit is Quality/Purchasing per the module's own department split (cost recording only, not full edit). */
export function WarrantyCostPanel({ claimId, actualCost, canEdit }: { claimId: number; actualCost: string | null; canEdit: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [costType, setCostType] = useState<WarrantyCostType>("parts");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const { data: costs = [], isLoading } = useQuery<WarrantyClaimCost[]>({
    queryKey: ["warranty/claims", claimId, "costs"],
    queryFn: async () => (await apiClient.get(`/warranty/claims/${claimId}/costs`)).data,
  });

  const addCost = useMutation({
    mutationFn: async () => (await apiClient.post(`/warranty/claims/${claimId}/costs`, { costType, amount: Number(amount), notes: notes || undefined })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warranty/claims", claimId, "costs"] });
      queryClient.invalidateQueries({ queryKey: ["warranty/claims", claimId] });
      setAmount("");
      setNotes("");
      toast.success("Cost entry recorded.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't record this cost entry.")),
  });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Cost Tracking</h3>
        <span className="text-sm font-medium">Total: {actualCost ? `$${Number(actualCost).toFixed(2)}` : "$0.00"}</span>
      </div>

      {isLoading ? (
        <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
      ) : costs.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No cost entries yet.</p>
      ) : (
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="pb-1">Type</th>
              <th className="pb-1">Amount</th>
              <th className="pb-1">Notes</th>
              <th className="pb-1">Recorded</th>
            </tr>
          </thead>
          <tbody>
            {costs.map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="py-1 capitalize">{c.costType.replace(/_/g, " ")}</td>
                <td className="py-1">${Number(c.amount).toFixed(2)}</td>
                <td className="py-1 text-muted-foreground">{c.notes ?? "—"}</td>
                <td className="py-1 text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canEdit && (
        <div className="mt-3 grid grid-cols-4 items-end gap-2 border-t border-border pt-3">
          <SelectField label="Type" value={costType} onChange={(e) => setCostType(e.target.value as WarrantyCostType)}>
            {COST_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </SelectField>
          <TextField label="Amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <TextField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button
            onClick={() => addCost.mutate()}
            disabled={!amount || addCost.isPending}
            className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {addCost.isPending ? "Adding…" : "Add Cost"}
          </button>
        </div>
      )}
    </div>
  );
}
