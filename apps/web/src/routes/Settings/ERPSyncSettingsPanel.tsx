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
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";

function useErpSyncSettings() {
  return useQuery<ErpSyncSettings>({ queryKey: ["settings/erp-sync"], queryFn: async () => (await apiClient.get("/settings/erp-sync")).data });
}

/**
 * Settings → ERP / NetSuite. Admin only (see settings.routes.ts).
 * webhookSecret is write-only — the server never returns the real value
 * (see settings.controller.ts's getErpSyncSettingsHandler).
 * Loading this panel only reads saved settings. Test connection does the
 * same. Nothing here calls NetSuite until someone clicks Trigger Sync Now.
 */
export function ERPSyncSettingsPanel() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useErpSyncSettings();
  const [form, setForm] = useState<ErpSyncSettings>({
    schedule: "manual",
    direction: "push",
    modulesEnabled: [],
    conflictRules: {},
    retryPolicy: {},
    accountId: null,
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
          ...(form.schedule ? { schedule: form.schedule } : {}),
          ...(form.direction ? { direction: form.direction } : {}),
          modulesEnabled: form.modulesEnabled,
          conflictRules: form.conflictRules,
          retryPolicy: form.retryPolicy,
          accountId: form.accountId ?? "",
          webhookUrl: form.webhookUrl ?? "",
          ...(webhookSecret ? { webhookSecret } : {}),
        })
      ).data,
    onSuccess: (saved: ErpSyncSettings) => {
      setForm((f) => ({ ...f, ...saved }));
      setWebhookSecret("");
      queryClient.invalidateQueries({ queryKey: ["settings/erp-sync"] });
      toast.success("NetSuite settings saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save NetSuite settings.")),
  });

  const testConnection = useMutation({
    mutationFn: async () => (await apiClient.post("/settings/erp-sync/test")).data as { connected: boolean; message: string },
    onSuccess: (result) => {
      if (result.connected) toast.success(result.message);
      else toast.error(result.message);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't check the NetSuite connection.")),
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

  if (isLoading) return <LoadingPlaceholder />;
  if (isError) return <p className="text-sm text-destructive">Couldn't load NetSuite connection settings.</p>;

  const connected = Boolean(form.accountId?.trim() || form.webhookUrl?.trim());

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-1 text-sm font-medium">{connected ? "Connected" : "Not connected yet"}</h3>
        <p className="mb-3 text-sm text-muted-foreground">
          {connected
            ? "These NetSuite account details are saved on this server. Test connection checks that saved record. It does not contact NetSuite."
            : "Enter the NetSuite account details below. Test connection checks what is saved. It does not contact NetSuite."}
        </p>
        <div className="flex flex-col gap-3">
          <TextField
            label="NetSuite account ID"
            value={form.accountId ?? ""}
            onChange={(e) => setForm({ ...form, accountId: e.target.value })}
            placeholder="1234567 or 1234567_SB1"
            autoComplete="off"
          />
          <TextField
            label="Webhook URL"
            value={form.webhookUrl ?? ""}
            onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
            placeholder="https://your-account.restlets.api.netsuite.com/..."
          />
          <TextField
            label={form.hasWebhookSecret ? "Webhook secret (saved — enter a value to replace it)" : "Webhook secret"}
            type="password"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder={form.hasWebhookSecret ? "••••••••" : "Used to sign each payload (HMAC-SHA256)"}
            autoComplete="new-password"
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Schedule &amp; Direction</h3>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <SyncScheduleSelector value={form.schedule} onChange={(v) => setForm({ ...form, schedule: v })} />
          </div>
          <div className="flex-1">
            <SelectField label="Direction" value={form.direction ?? "push"} onChange={(e) => setForm({ ...form, direction: e.target.value as ErpSyncSettings["direction"] })}>
              <option value="push">Push (AccuQual → NetSuite)</option>
              <option value="pull">Pull (NetSuite → AccuQual)</option>
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

      <p className="text-xs text-muted-foreground">
        Every sync sends an HMAC-SHA256 signature in the <code>X-AccuQual-Signature</code> header when a secret is set, so NetSuite can verify the payload. Saving and testing stay on this server until you choose Trigger Sync Now.
      </p>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => save.mutate()} disabled={save.isPending} className="w-fit rounded-md bg-button px-4 py-2 text-sm font-medium text-button-foreground disabled:opacity-60">
          {save.isPending ? "Saving…" : "Save NetSuite settings"}
        </button>
        <button
          type="button"
          onClick={() => testConnection.mutate()}
          disabled={testConnection.isPending}
          className="w-fit rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-60"
        >
          {testConnection.isPending ? "Checking…" : "Test connection"}
        </button>
        <button
          onClick={() => trigger.mutate()}
          disabled={trigger.isPending}
          className="w-fit rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
        >
          {trigger.isPending ? "Syncing…" : "Trigger Sync Now"}
        </button>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Sync status</h3>
        <SyncStatusHistoryViewer history={form.statusHistory} />
      </div>
    </div>
  );
}
