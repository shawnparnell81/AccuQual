import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { TextField, SelectField } from "../forms/Field";
import { StatusBadge } from "../tables/StatusBadge";
import { WorkflowActionButton } from "../shared/WorkflowActionButton";
import { useToast } from "../shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { documentExpirationStatus } from "../../lib/workflowMetrics";
import type { AccuQualDocument } from "../../api/types";

/**
 * Expiration + retention settings for one document, plus a way to run
 * retention immediately. Retention only actually acts on documents whose
 * status is "obsolete" (see applyRetentionHandler) — this panel lets you set
 * the rule ahead of time regardless of current status.
 */
export function DocumentRetentionPanel({ document }: { document: AccuQualDocument }) {
  const [form, setForm] = useState({
    expirationDate: document.expirationDate?.slice(0, 10) ?? "",
    expirationWarningDays: document.expirationWarningDays,
    retentionPeriodDays: document.retentionPeriodDays,
    retentionAction: document.retentionAction,
  });
  const queryClient = useQueryClient();
  const toast = useToast();

  const save = useMutation({
    mutationFn: async () =>
      (
        await apiClient.patch(`/documents/${document.id}`, {
          expirationDate: form.expirationDate || null,
          expirationWarningDays: Number(form.expirationWarningDays),
          retentionPeriodDays: Number(form.retentionPeriodDays),
          retentionAction: form.retentionAction,
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["workflow-history", "documents", document.id] });
      toast.success("Retention rules saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save retention rules.")),
  });

  const runRetention = useMutation({
    mutationFn: async () => (await apiClient.post("/documents/retention/apply")).data as { processed: number },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["workflow-history", "documents", document.id] });
      toast.success(data.processed === 0 ? "No documents were aged-out enough to act on." : `Processed ${data.processed} document(s).`);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't run retention.")),
  });

  // New in Phase 6 (services/api's documents.controller.ts): archives this
  // one document on demand instead of waiting for the tenant-wide sweep
  // above. Same eligibility rule server-side (decideRetention()).
  const archiveNow = useMutation({
    mutationFn: async () => (await apiClient.post(`/documents/${document.id}/archive`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["workflow-history", "documents", document.id] });
      toast.success("Document archived.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't archive this document.")),
  });

  const status = documentExpirationStatus(form.expirationDate || null, Number(form.expirationWarningDays));

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">Expiration &amp; Retention</h3>
        <div className="flex items-center gap-2">
          <StatusBadge value={document.retentionState} />
          {status && <StatusBadge value={status} label={status === "expired" ? "Expired" : "Expiring Soon"} />}
        </div>
      </div>

      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <TextField label="Expiration Date" type="date" value={form.expirationDate} onChange={(e) => setForm({ ...form, expirationDate: e.target.value })} />
        <TextField
          label="Warn Before Expiring (days)"
          type="number"
          min={1}
          value={form.expirationWarningDays}
          onChange={(e) => setForm({ ...form, expirationWarningDays: Number(e.target.value) })}
        />
        <TextField
          label="Retention Period After Obsolete (days)"
          type="number"
          min={1}
          value={form.retentionPeriodDays}
          onChange={(e) => setForm({ ...form, retentionPeriodDays: Number(e.target.value) })}
        />
        <SelectField
          label="When Retention Period Ends"
          value={form.retentionAction}
          onChange={(e) => setForm({ ...form, retentionAction: e.target.value as "archive" | "delete" })}
        >
          <option value="archive">Archive</option>
          <option value="delete">Delete</option>
        </SelectField>

        <div className="col-span-full flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => runRetention.mutate()}
              disabled={runRetention.isPending}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
              title="Applies retention rules to every obsolete, aged-out document in this tenant right now"
            >
              {runRetention.isPending ? "Running…" : "Run Retention Now"}
            </button>
            <WorkflowActionButton
              label="Archive This Document Now"
              navKey="documents"
              action={archiveNow}
              onClick={() => archiveNow.mutate()}
              visible={document.status === "obsolete" && document.retentionState !== "archived"}
            />
          </div>
          <button type="submit" disabled={save.isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
            {save.isPending ? "Saving…" : "Save Rules"}
          </button>
        </div>
      </form>
    </div>
  );
}
