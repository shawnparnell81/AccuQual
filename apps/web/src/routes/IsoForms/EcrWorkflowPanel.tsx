import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { SignatureStamp } from "../../components/forms/SignatureStamp";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { ECR_STRUCTURE_CERTIFY, ECR_LABEL_DEFAULTS } from "../../lib/ecrTemplate";
import { ECR_ACTION_LABEL, ecrStatusLabel, type EcrWorkflowView } from "../../lib/ecrWorkflow";
import { formatDateTime } from "../../lib/dates";

export function EcrWorkflowPanel({
  recordId,
  view,
  canEditStructure,
  busy,
  onTransition,
}: {
  recordId: number;
  view: EcrWorkflowView;
  canEditStructure: boolean;
  busy: boolean;
  onTransition: (action: string, note?: string) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState("");
  const [labels, setLabels] = useState<Record<string, string>>(view.labels);
  const status = ecrStatusLabel(view.workflow.status);
  const engineering = view.workflow.engineeringReview;
  const quality = view.workflow.qualityReview;

  const saveStructure = useMutation({
    mutationFn: async (next: Record<string, string>) =>
      (await apiClient.put("/iso-quality-forms/structure/engineering-change", { pin, certified: true, labels: next })).data,
    onSuccess: async () => {
      setPin("");
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ["ecr-workflow", recordId] });
      await queryClient.invalidateQueries({ queryKey: ["ecr-structure"] });
    },
  });

  async function run(action: string) {
    setError(null);
    try {
      await onTransition(action, action === "reject" ? note.trim() : undefined);
      if (action === "reject") setNote("");
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't update this engineering change request."));
    }
  }

  return (
    <div className="no-print flex flex-col gap-3 rounded-lg border border-border bg-card p-4" data-testid="ecr-workflow">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Workflow · {status}</h2>
        <p className="text-xs text-muted-foreground">Template Rev {view.templateRevision}</p>
      </div>
      <p className="text-sm text-muted-foreground">
        Engineering review and quality review can be finished in either order. Approval waits for both, and for the manager signature.
      </p>
      <ul className="flex flex-col gap-1 text-sm">
        <li>Engineering review: {engineering ? `${engineering.by}` : "Open"}</li>
        <li>Quality review: {quality ? `${quality.by}` : "Open"}</li>
      </ul>
      {view.blockers.length > 0 && view.workflow.status === "review" && (
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          {view.blockers.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {view.labelsFrozen && <p className="text-sm text-muted-foreground">This copy keeps the template it was submitted on.</p>}
      {view.lastChange && (
        <p className="text-sm">
          {view.lastChange.who} · {view.lastChange.what} · {formatDateTime(view.lastChange.when)}. {view.lastChange.description}
        </p>
      )}
      {view.actions.includes("reject") && (
        <label className="flex flex-col gap-1 text-sm">
          Why is this rejected?
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} className="rounded-md border border-border bg-background px-2 py-1" />
        </label>
      )}
      {view.actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {view.actions.map((action) => (
            <button
              key={action}
              type="button"
              disabled={busy || (action === "reject" && !note.trim())}
              onClick={() => void run(action)}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60"
            >
              {ECR_ACTION_LABEL[action] ?? action}
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {canEditStructure && !editing && (
        <div className="border-t border-border pt-3">
          <p className="mb-2 text-sm text-muted-foreground">Changing the template needs your role and your PIN. Filling this copy does not.</p>
          <SignatureStamp
            certify={ECR_STRUCTURE_CERTIFY}
            onSign={async (entered) => {
              await apiClient.post("/iso-quality-forms/structure/engineering-change/unlock", { pin: entered, certified: true });
              setLabels(view.labels);
              setPin(entered);
              setEditing(true);
            }}
          />
        </div>
      )}
      {editing && (
        <form
          className="flex flex-col gap-2 border-t border-border pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            saveStructure.mutate(labels);
          }}
        >
          <p className="text-sm font-medium">Template labels</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.keys(ECR_LABEL_DEFAULTS).map((key) => (
              <label key={key} className="flex flex-col gap-1 text-xs">
                {ECR_LABEL_DEFAULTS[key]}
                <input
                  aria-label={key}
                  value={labels[key] ?? ""}
                  onChange={(event) => setLabels((current) => ({ ...current, [key]: event.target.value }))}
                  className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                />
              </label>
            ))}
          </div>
          {saveStructure.isError && <p className="text-sm text-destructive">{extractErrorMessage(saveStructure.error, "Couldn't save the template.")}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={saveStructure.isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
              {saveStructure.isPending ? "Saving…" : "Save structure"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPin("");
                setEditing(false);
              }}
              className="rounded-md border border-border px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
