import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { TextField, SelectField } from "../forms/Field";
import { StatusBadge } from "../tables/StatusBadge";
import type { AccuQualDocument } from "../../api/types";

/** Computed the same way as the server (documents.controller.ts's expirationStatus) — kept here purely for an instant badge while typing, before the next save round-trips it. */
function computeExpirationStatus(expirationDate: string | null, warningDays: number): "expired" | "expiring_soon" | null {
  if (!expirationDate) return null;
  const now = new Date();
  const expiresAt = new Date(expirationDate);
  if (now >= expiresAt) return "expired";
  const warnAt = new Date(expiresAt);
  warnAt.setDate(warnAt.getDate() - warningDays);
  return now >= warnAt ? "expiring_soon" : null;
}

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
      queryClient.invalidateQueries({ queryKey: ["audit-trail", "Document", document.id] });
    },
  });

  const runRetention = useMutation({
    mutationFn: async () => (await apiClient.post("/documents/retention/apply")).data as { processed: number },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["audit-trail", "Document", document.id] });
    },
  });

  const status = computeExpirationStatus(form.expirationDate || null, Number(form.expirationWarningDays));

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

        <div className="col-span-full flex items-center justify-between border-t border-border pt-3">
          <button
            type="button"
            onClick={() => runRetention.mutate()}
            disabled={runRetention.isPending}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
            title="Applies retention rules to every obsolete, aged-out document in this tenant right now"
          >
            {runRetention.isPending ? "Running…" : "Run Retention Now"}
          </button>
          <button type="submit" disabled={save.isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
            {save.isPending ? "Saving…" : "Save Rules"}
          </button>
        </div>
        {runRetention.isSuccess && (
          <p className="col-span-full text-xs text-muted-foreground">
            {runRetention.data.processed === 0 ? "No documents were aged-out enough to act on." : `Processed ${runRetention.data.processed} document(s).`}
          </p>
        )}
      </form>
    </div>
  );
}
