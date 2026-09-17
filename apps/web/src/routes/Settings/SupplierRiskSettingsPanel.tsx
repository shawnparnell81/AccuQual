import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import type { SupplierRiskSettings } from "../../api/types";

const FACTORS: { key: keyof SupplierRiskSettings; label: string; hint: string }[] = [
  { key: "ncr", label: "NCR Count", hint: "10+ NCRs on file = maximum contribution" },
  { key: "capa", label: "CAPA Count", hint: "6+ CAPAs = maximum contribution" },
  { key: "capaRecurrence", label: "CAPA Recurrence", hint: "A new NCR after a CAPA already closed; 3+ = maximum contribution" },
  { key: "delivery", label: "Delivery Performance", hint: "On-time % and delivery accuracy, reusing the Suppliers module's own delivery heuristic" },
  { key: "defectRate", label: "Defect Rate", hint: "(NCRs + RMAs) ÷ receiving events; 20%+ = maximum contribution" },
  { key: "warranty", label: "Warranty Fault Rate", hint: "5+ warranty claims = maximum contribution" },
  { key: "responsiveness", label: "Communication Responsiveness", hint: "Average reply time in the Supplier Portal thread; 72+ hours = maximum contribution" },
];

function useSupplierRiskSettings() {
  return useQuery<SupplierRiskSettings>({ queryKey: ["settings/supplier-risk"], queryFn: async () => (await apiClient.get("/settings/supplier-risk")).data });
}

/**
 * Settings → Supplier Risk (Phase 7) — weights for the Supplier Quality
 * Risk Score's 7 factors (see supplier.qualityRisk.ts). Deliberately
 * placed here rather than on PlatformAdminPage — see tenants.ts's own
 * schema comment on why: that page is platform_admin/cross-tenant
 * tenant-provisioning only, with no precedent for per-tenant module
 * config, while every other tenant-scoped "config a human occasionally
 * edits" (Feasibility/Inventory/ERP Sync) already lives in Settings.
 */
export function SupplierRiskSettingsPanel() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useSupplierRiskSettings();
  const [form, setForm] = useState<SupplierRiskSettings>({});

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: async (body: SupplierRiskSettings) => (await apiClient.post("/settings/supplier-risk", body)).data,
    onSuccess: (saved: SupplierRiskSettings) => {
      setForm(saved);
      queryClient.invalidateQueries({ queryKey: ["settings/supplier-risk"] });
      toast.success("Supplier Risk weights saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save Supplier Risk settings.")),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-1 text-sm font-medium">Quality Risk Score Formula Weights</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Each factor is normalized 0-100% against the threshold shown, then combined by these weights into the 0-100 score shown on every supplier's Scorecard. Weights don't need to sum to any
          particular total — they're normalized by their own sum, so raising one factor doesn't require rebalancing the rest by hand. Leave a field blank to use the default weight.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {FACTORS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{f.label}</span>
              <input
                type="number"
                min={0}
                step={1}
                value={form[f.key] ?? ""}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value === "" ? undefined : Number(e.target.value) })}
                className="rounded-md border border-form-field bg-background px-3 py-2 text-sm"
              />
              <span className="text-xs text-muted-foreground">{f.hint}</span>
            </label>
          ))}
        </div>
      </div>

      <button onClick={() => save.mutate(form)} disabled={save.isPending} className="w-fit rounded-md bg-button px-4 py-2 text-sm font-medium text-button-foreground disabled:opacity-60">
        {save.isPending ? "Saving…" : "Save Supplier Risk Settings"}
      </button>
    </div>
  );
}
