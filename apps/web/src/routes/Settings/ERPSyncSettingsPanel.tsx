import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { SelectField, TextField } from "../../components/forms/Field";
import type { ErpSyncSettings, ErpSyncTriggerResult } from "../../api/types";
import { SyncScheduleSelector } from "./SyncScheduleSelector";
import { SyncModuleSelector } from "./SyncModuleSelector";
import { SyncConflictRuleEditor } from "./SyncConflictRuleEditor";
import { SyncStatusHistoryViewer } from "./SyncStatusHistoryViewer";

function useErpSyncSettings() {
  return useQuery<ErpSyncSettings>({ queryKey: ["settings/erp-sync"], queryFn: async () => (await apiClient.get("/settings/erp-sync")).data });
}

/**
 * Settings → ERP Sync Engine. Admin only (see settings.routes.ts).
 * webhookSecret is write-only — the server never returns the real value
 * (see settings.controller.ts's getErpSyncSettingsHandler), same convention
 * as the AI Config BYOK key field.
 */
export function ERPSyncSettingsPanel() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useErpSyncSettings();
  const [form, setForm] = useState<ErpSyncSettings>({
    schedule: "manual",
    direction: "push",
    modulesEnabled: [],
    conflictRules: {},
    retryPolicy: {},
    webhookUrl: null,
    hasWebhookSecret: false,
    statusHistory: [],
  });
  const [webhookSecret, setWebhookSecret] = useState("");

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post("/settings/erp-sync", {
          schedule: form.schedule,
          direction: form.direction,
          modulesEnabled: form.modulesEnabled,
          conflictRules: form.conflictRules,
          retryPolicy: form.retryPolicy,
          webhookUrl: form.webhookUrl ?? "",
          ...(webhookSecret ? { webhookSecret } : {}),
        })
      ).data,
    onSuccess: (saved: ErpSyncSettings) => {
      setForm((f) => ({ ...f, ...saved }));
      setWebhookSecret("");
      queryClient.invalidateQueries({ queryKey: ["settings/erp-sync"] });
      toast.success("ERP Sync settings saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save ERP Sync settings.")),
  });

  const trigger = useMutation({
    mutationFn: async () => (await apiClient.post("/settings/erp-sync/trigger")).data as ErpSyncTriggerResult,
    onSuccess: (result) => {
      setForm((f) => ({ ...f, statusHistory: result.history }));
      if (result.status === "success") toast.success(result.message);
      else if (result.status === "skipped") toast.error(result.message);
      else toast.error(result.message || "Sync failed.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't trigger a sync.")),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Schedule &amp; Direction</h3>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <SyncScheduleSelector value={form.schedule} onChange={(v) => setForm({ ...form, schedule: v })} />
          </div>
          <div className="flex-1">
            <SelectField label="Direction" value={form.direction ?? "push"} onChange={(e) => setForm({ ...form, direction: e.target.value as ErpSyncSettings["direction"] })}>
              <option value="push">Push (AccuQual → ERP)</option>
              <option value="pull">Pull (ERP → AccuQual)</option>
              <option value="bidirectional">Bidirectional</option>
            </SelectField>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <SyncModuleSelector value={form.modulesEnabled} onChange={(v) => setForm({ ...form, modulesEnabled: v })} />
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Conflicts &amp; Retries</h3>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <SyncConflictRuleEditor value={form.conflictRules.resolutionStrategy} onChange={(v) => setForm({ ...form, conflictRules: { resolutionStrategy: v } })} />
          </div>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="font-medium">Max Retries</span>
            <input
              type="number"
              min={0}
              max={5}
              value={form.retryPolicy.maxRetries ?? 0}
              onChange={(e) => setForm({ ...form, retryPolicy: { ...form.retryPolicy, maxRetries: Number(e.target.value) } })}
              className="w-full rounded-md border border-form-field bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="font-medium">Backoff (seconds)</span>
            <input
              type="number"
              min={0}
              max={10}
              value={form.retryPolicy.backoffSeconds ?? 0}
              onChange={(e) => setForm({ ...form, retryPolicy: { ...form.retryPolicy, backoffSeconds: Number(e.target.value) } })}
              className="w-full rounded-md border border-form-field bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Webhook</h3>
        <div className="flex flex-col gap-3">
          <TextField label="Webhook URL" value={form.webhookUrl ?? ""} onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })} placeholder="https://your-erp.example.com/accuqual-sync" />
          <TextField
            label={form.hasWebhookSecret ? "Webhook Secret (set — enter a value to replace it)" : "Webhook Secret"}
            type="password"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder={form.hasWebhookSecret ? "••••••••" : "Used to sign each payload (HMAC-SHA256)"}
          />
          <p className="text-xs text-muted-foreground">
            Every sync sends an HMAC-SHA256 signature in the <code>X-AccuQual-Signature</code> header when a secret is set, so the receiving system can verify the payload.
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={() => save.mutate()} disabled={save.isPending} className="w-fit rounded-md bg-button px-4 py-2 text-sm font-medium text-button-foreground disabled:opacity-60">
          {save.isPending ? "Saving…" : "Save ERP Sync Settings"}
        </button>
        <button
          onClick={() => trigger.mutate()}
          disabled={trigger.isPending}
          className="w-fit rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-60"
        >
          {trigger.isPending ? "Syncing…" : "Trigger Sync Now"}
        </button>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Sync History</h3>
        <SyncStatusHistoryViewer history={form.statusHistory} />
      </div>
    </div>
  );
}
