import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { DEFECT_CATEGORIES } from "../../api/types";
import type { ReceivingSettings } from "../../api/types";

function useReceivingSettings() {
  return useQuery<ReceivingSettings>({ queryKey: ["settings/receiving"], queryFn: async () => (await apiClient.get("/settings/receiving")).data });
}

/**
 * Settings → Receiving (Phase 8) — the auto-trigger/escalation config
 * receivingAutomation.ts reads every time a receiving line item's
 * disposition moves to rejected or quarantined. Placed here rather than
 * on PlatformAdminPage, same reasoning as SupplierRiskSettingsPanel.tsx.
 */
export function ReceivingSettingsPanel() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useReceivingSettings();
  const [form, setForm] = useState<ReceivingSettings>({});

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: async (body: ReceivingSettings) => (await apiClient.post("/settings/receiving", body)).data,
    onSuccess: (saved: ReceivingSettings) => {
      setForm(saved);
      queryClient.invalidateQueries({ queryKey: ["settings/receiving"] });
      toast.success("Receiving settings saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save Receiving settings.")),
  });

  function toggleCategory(category: string) {
    const current = form.autoCreateNcrDefectCategories ?? [];
    setForm({ ...form, autoCreateNcrDefectCategories: current.includes(category) ? current.filter((c) => c !== category) : [...current, category] });
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-1 text-sm font-medium">NCR Auto-Trigger</h3>
        <p className="mb-3 text-xs text-muted-foreground">When a receiving inspection's disposition moves to rejected or quarantined, automatically create an NCR linked to that receiving event and supplier.</p>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.autoCreateNcrOnRejection ?? false} onChange={(e) => setForm({ ...form, autoCreateNcrOnRejection: e.target.checked })} className="h-4 w-4 rounded border-form-field" />
            <span>Auto-create NCR on rejection</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.autoCreateNcrOnQuarantine ?? false} onChange={(e) => setForm({ ...form, autoCreateNcrOnQuarantine: e.target.checked })} className="h-4 w-4 rounded border-form-field" />
            <span>Auto-create NCR on quarantine</span>
          </label>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Limit to defect categories (optional — leave all unchecked to qualify on any category)</p>
          <div className="flex flex-wrap gap-2">
            {DEFECT_CATEGORIES.map((c) => (
              <label key={c} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs capitalize">
                <input type="checkbox" checked={(form.autoCreateNcrDefectCategories ?? []).includes(c)} onChange={() => toggleCategory(c)} className="h-3.5 w-3.5 rounded border-form-field" />
                {c.replace(/_/g, " ")}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-1 text-sm font-medium">CAPA Escalation</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          When a supplier accumulates this many rejected/quarantined receiving line items within the rolling window below, auto-create a CAPA escalation (skipped while one is already open for that supplier).
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Threshold (occurrences)</span>
            <input
              type="number"
              min={1}
              value={form.capaEscalationThreshold ?? ""}
              placeholder="3 (default)"
              onChange={(e) => setForm({ ...form, capaEscalationThreshold: e.target.value === "" ? undefined : Number(e.target.value) })}
              className="rounded-md border border-form-field bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Rolling window (days)</span>
            <input
              type="number"
              min={1}
              value={form.capaEscalationWindowDays ?? ""}
              placeholder="90 (default)"
              onChange={(e) => setForm({ ...form, capaEscalationWindowDays: e.target.value === "" ? undefined : Number(e.target.value) })}
              className="rounded-md border border-form-field bg-background px-3 py-2 text-sm"
            />
          </label>
        </div>
      </div>

      <button onClick={() => save.mutate(form)} disabled={save.isPending} className="w-fit rounded-md bg-button px-4 py-2 text-sm font-medium text-button-foreground disabled:opacity-60">
        {save.isPending ? "Saving…" : "Save Receiving Settings"}
      </button>
    </div>
  );
}
