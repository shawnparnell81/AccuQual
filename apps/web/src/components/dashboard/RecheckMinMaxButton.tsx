import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { apiClient } from "../../api/client";
import { useToast } from "../shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import type { InventoryItem } from "../../api/types";

interface CheckMinMaxResult {
  checked: number;
  changed: number;
  items: InventoryItem[];
}

/**
 * The one manual trigger for inventory.service.ts's recomputeState — a
 * plain button, not a resource/id/action mutation (POST /inventory/
 * check-minmax has no :id, unlike every other useWorkflowAction call site),
 * so this is its own small useMutation rather than a forced fit into that
 * hook's shape. There is no scheduled/cron re-check — AccuQual has no
 * time-triggered infrastructure (see the Min/Max Engine review) — so this
 * button plus the automatic recompute after every movement are the only
 * two ways min/max ever gets evaluated.
 */
export function RecheckMinMaxButton() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [lastResult, setLastResult] = useState<CheckMinMaxResult | null>(null);

  const recheck = useMutation({
    mutationFn: async () => (await apiClient.post<CheckMinMaxResult>("/inventory/check-minmax", {})).data,
    onSuccess: (result) => {
      setLastResult(result);
      queryClient.invalidateQueries({ queryKey: ["inventory/items"] });
      queryClient.invalidateQueries({ queryKey: ["inventory/alerts"] });
      toast.success(`Re-checked ${result.checked} item${result.checked === 1 ? "" : "s"}.`);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't re-check min/max.")),
  });

  const changed = lastResult?.changed ?? 0;

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => recheck.mutate()}
        disabled={recheck.isPending}
        className="flex w-fit items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RefreshCw size={14} className={recheck.isPending ? "animate-spin" : ""} />
        {recheck.isPending ? "Re-checking…" : "Re-check Min/Max"}
      </button>
      {lastResult && (
        <p className="text-xs text-muted-foreground">
          Last run: {lastResult.checked} item{lastResult.checked === 1 ? "" : "s"} evaluated
          {changed > 0 ? `, ${changed} state${changed === 1 ? "" : "s"} changed` : ", no state changes"}.
        </p>
      )}
    </div>
  );
}
