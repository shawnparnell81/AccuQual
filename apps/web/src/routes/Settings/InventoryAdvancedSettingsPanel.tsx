import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { SelectField } from "../../components/forms/Field";
import type { InventorySettings } from "../../api/types";
import { LotNumberFormatEditor } from "./LotNumberFormatEditor";
import { SerialNumberFormatEditor } from "./SerialNumberFormatEditor";
import { InventoryAgingRuleEditor } from "./InventoryAgingRuleEditor";

function useInventorySettings() {
  return useQuery<InventorySettings>({ queryKey: ["settings/inventory"], queryFn: async () => (await apiClient.get("/settings/inventory")).data });
}

/**
 * Settings → Inventory Module expansion. Read by inventory.service.ts (lot/
 * serial generation, reservation rules, aging), inventory.controller.ts
 * (cycle count due) and inventory.costing.ts (cost rounding) — see each
 * file's own comments. Production + Purchasing + Admin only (see
 * settings.routes.ts).
 */
export function InventoryAdvancedSettingsPanel() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useInventorySettings();
  const [form, setForm] = useState<InventorySettings>({});

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: async (body: InventorySettings) => (await apiClient.post("/settings/inventory", body)).data,
    onSuccess: (saved: InventorySettings) => {
      setForm(saved);
      queryClient.invalidateQueries({ queryKey: ["settings/inventory"] });
      toast.success("Inventory settings saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save Inventory settings.")),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Lot &amp; Serial Number Generation</h3>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <LotNumberFormatEditor
              enabled={form.autoGenerateLotNumbers ?? false}
              format={form.lotNumberFormat ?? ""}
              onChangeEnabled={(v) => setForm({ ...form, autoGenerateLotNumbers: v })}
              onChangeFormat={(v) => setForm({ ...form, lotNumberFormat: v })}
            />
          </div>
          <div className="flex-1">
            <SerialNumberFormatEditor
              enabled={form.autoGenerateSerialNumbers ?? false}
              format={form.serialNumberFormat ?? ""}
              onChangeEnabled={(v) => setForm({ ...form, autoGenerateSerialNumbers: v })}
              onChangeFormat={(v) => setForm({ ...form, serialNumberFormat: v })}
            />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Aging</h3>
        <InventoryAgingRuleEditor
          warningDays={form.agingRules?.warningDays}
          criticalDays={form.agingRules?.criticalDays}
          onChange={(rules) => setForm({ ...form, agingRules: rules })}
        />
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Reservations</h3>
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.reservationRules?.allowNegativeAllocation ?? false}
              onChange={(e) => setForm({ ...form, reservationRules: { ...form.reservationRules, allowNegativeAllocation: e.target.checked } })}
              className="h-4 w-4 rounded border-form-field"
            />
            <span>Allow reserving more than on-hand (backorder-style)</span>
          </label>
          <label className="flex max-w-xs flex-col gap-1 text-sm">
            <span className="font-medium">Auto-release reservations after (days)</span>
            <input
              type="number"
              min={1}
              value={form.reservationRules?.autoReleaseAfterDays ?? ""}
              onChange={(e) => setForm({ ...form, reservationRules: { ...form.reservationRules, autoReleaseAfterDays: e.target.value ? Number(e.target.value) : undefined } })}
              placeholder="Never"
              className="w-full rounded-md border border-form-field bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Cost Adjustment</h3>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <SelectField
              label="Method"
              value={form.costAdjustmentRules?.method ?? "latest"}
              onChange={(e) => setForm({ ...form, costAdjustmentRules: { ...form.costAdjustmentRules, method: e.target.value as "average" | "latest" } })}
            >
              <option value="latest">Latest cost</option>
              <option value="average">Average cost</option>
            </SelectField>
            {form.costAdjustmentRules?.method === "average" && (
              <p className="mt-1 text-xs text-muted-foreground">AccuQual stores no cost-layer history yet — "Average" resolves to the same figure as "Latest" until that exists.</p>
            )}
          </div>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="font-medium">Rounding Precision (decimal places)</span>
            <input
              type="number"
              min={0}
              max={6}
              value={form.costAdjustmentRules?.roundingPrecision ?? 2}
              onChange={(e) => setForm({ ...form, costAdjustmentRules: { ...form.costAdjustmentRules, roundingPrecision: Number(e.target.value) } })}
              className="w-full rounded-md border border-form-field bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Cycle Counts</h3>
        <div className="max-w-xs">
          <SelectField label="Audit Frequency" value={form.auditFrequency ?? ""} onChange={(e) => setForm({ ...form, auditFrequency: (e.target.value || undefined) as InventorySettings["auditFrequency"] })}>
            <option value="">Not tracked</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
          </SelectField>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Items overdue for a count (per this frequency) show a "Cycle count due" flag on the Inventory list — recorded via each item's "Record Count" action.</p>
      </div>

      <button
        onClick={() => save.mutate(form)}
        disabled={save.isPending}
        className="w-fit rounded-md bg-button px-4 py-2 text-sm font-medium text-button-foreground disabled:opacity-60"
      >
        {save.isPending ? "Saving…" : "Save Inventory Settings"}
      </button>
    </div>
  );
}
