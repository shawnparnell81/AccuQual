import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { formatDateTime } from "../../lib/dates";
import { MAX_REVISION, newRevisionProblem } from "../../lib/formRevision";
import { useToast } from "../shared/ToastProvider";

export const APPROVAL_CERTIFY = "I certify that I reviewed this revision and approve it.";

/** PIN and certification box the approver fills in. The PIN is the person's own signature PIN. */
export function ApprovalSignatureFields({
  pin,
  certified,
  onPin,
  onCertified,
}: {
  pin: string;
  certified: boolean;
  onPin: (pin: string) => void;
  onCertified: (certified: boolean) => void;
}) {
  return (
    <div className="mt-3 space-y-2 text-sm">
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={certified} onChange={(event) => onCertified(event.target.checked)} className="mt-1" />
        <span>{APPROVAL_CERTIFY}</span>
      </label>
      <label className="block">
        Signature PIN
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          name="approval-pin"
          aria-label="4-digit signature PIN"
          className="mt-1 block w-28 rounded border border-border bg-background px-2 py-1 tracking-widest"
          value={pin}
          onChange={(event) => onPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
        />
      </label>
    </div>
  );
}

export function approvalReady(pin: string, certified: boolean): boolean {
  return certified && /^\d{4}$/.test(pin);
}

interface HistoryRow {
  id: number;
  revision: string;
  previousRevision: string | null;
  description: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  createdByName: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  decisionNote: string | null;
  approvalSignature: string | null;
}

interface RevisionView {
  formKey: string;
  formId: string;
  title: string;
  currentRevision: string | null;
  pendingRevision: string | null;
  pendingRevisionId: number | null;
  canEdit: boolean;
  canApprove: boolean;
  history: HistoryRow[];
}

/**
 * Revision history of a built-in form, with Start new revision and the PIN-signed approval.
 * The REV is always typed by the person. Filled copies keep the REV they were opened with.
 */
export function FormRevisionHistory({ formKey }: { formKey: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const queryKey = ["form-revisions", formKey];
  const view = useQuery({
    queryKey,
    enabled: formKey.length > 0,
    retry: false,
    queryFn: async () => (await apiClient.get<RevisionView>(`/form-revisions/${encodeURIComponent(formKey)}`)).data,
  });
  const [starting, setStarting] = useState(false);
  const [newRevision, setNewRevision] = useState("");
  const [description, setDescription] = useState("");
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [pin, setPin] = useState("");
  const [certified, setCertified] = useState(false);

  const done = (data: RevisionView) => queryClient.setQueryData(queryKey, data);
  const start = useMutation({
    mutationFn: async () =>
      (await apiClient.post<RevisionView>(`/form-revisions/${encodeURIComponent(formKey)}`, { newRevision: newRevision.trim(), changeDescription: description.trim() })).data,
    onSuccess: (data) => {
      done(data);
      setStarting(false);
      setNewRevision("");
      setDescription("");
      toast.success("Revision started. It is recorded once it is approved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Could not start that revision.")),
  });
  const decide = useMutation({
    mutationFn: async (kind: "approve" | "reject") =>
      (
        await apiClient.post<RevisionView>(
          `/form-revisions/${encodeURIComponent(formKey)}/${view.data!.pendingRevisionId}/${kind}`,
          kind === "approve" ? { note: note.trim(), pin, certified } : { note: note.trim() },
        )
      ).data,
    onSuccess: (data, kind) => {
      done(data);
      setDecision(null);
      setNote("");
      setPin("");
      setCertified(false);
      toast.success(kind === "approve" ? "Revision approved. Update the Master Document List with the new revision." : "Revision rejected. The current revision is unchanged.");
    },
    onError: (err) => {
      setPin("");
      toast.error(extractErrorMessage(err, "Could not record that decision."));
    },
  });

  if (!view.data) return null;
  const data = view.data;
  const current = data.currentRevision;
  const revisionProblem = current ? newRevisionProblem(current, newRevision) : newRevision.trim() ? (newRevision.trim().length > MAX_REVISION ? `The revision can be at most ${MAX_REVISION} characters.` : null) : "Enter the revision, such as A.";
  const startReady = !revisionProblem && description.trim().length > 0;

  return (
    <section className="rounded-lg border border-border bg-card p-3 text-sm" aria-label="Form revisions" data-testid="form-revision-history">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium">Revision history</h2>
        <span className="text-muted-foreground">{current ? `Current REV ${current}` : "No revision recorded yet"}</span>
        {data.pendingRevision ? <span className="text-amber-700 dark:text-amber-400">REV {data.pendingRevision} pending approval</span> : null}
        <span className="flex-1" />
        {data.canEdit && !data.pendingRevision ? (
          <button type="button" className="rounded border border-border px-2 py-1 hover:bg-muted" onClick={() => setStarting(true)}>
            Start new revision
          </button>
        ) : null}
        {data.canApprove && data.pendingRevisionId != null ? (
          <>
            <button type="button" className="rounded bg-primary px-2 py-1 text-primary-foreground" onClick={() => setDecision("approve")}>Approve REV {data.pendingRevision}</button>
            <button type="button" className="rounded border border-border px-2 py-1 hover:bg-muted" onClick={() => setDecision("reject")}>Reject</button>
          </>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Copies already filled keep the revision printed on them. The REV is never changed by the app; you type it when you start a revision.</p>
      <table className="mt-2 w-full text-left">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="py-1 pr-2 font-normal">REV</th>
            <th className="py-1 pr-2 font-normal">Date</th>
            <th className="py-1 pr-2 font-normal">What changed</th>
            <th className="py-1 pr-2 font-normal">Made by</th>
            <th className="py-1 font-normal">Approved by</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.history.map((row) => (
            <tr key={row.id} data-revision={row.revision} data-status={row.status}>
              <td className="py-1 pr-2 font-medium">{row.revision}</td>
              <td className="py-1 pr-2 whitespace-nowrap">{formatDateTime(row.createdAt)}</td>
              <td className="py-1 pr-2">{row.description}</td>
              <td className="py-1 pr-2">{row.createdByName ?? "Unknown"}</td>
              <td className="py-1">
                {row.status === "pending" ? (
                  <span className="text-amber-700 dark:text-amber-400">Pending approval</span>
                ) : row.status === "rejected" ? (
                  <span className="text-destructive">Rejected by {row.approvedByName}{row.decisionNote ? `: ${row.decisionNote}` : ""}</span>
                ) : (
                  <span>
                    {row.approvalSignature ?? `${row.approvedByName ?? "Unknown"}${row.approvedAt ? ` on ${formatDateTime(row.approvedAt)}` : ""}`}
                    {row.decisionNote ? <span className="block text-xs text-muted-foreground">{row.decisionNote}</span> : null}
                  </span>
                )}
              </td>
            </tr>
          ))}
          {data.history.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-1 text-muted-foreground">No revision recorded yet.</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {starting && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6" onClick={() => setStarting(false)}>
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-xl" onClick={(event) => event.stopPropagation()} role="dialog" aria-labelledby="start-revision-title">
            <h2 id="start-revision-title" className="text-sm font-medium">Start a new revision of {data.formId} {data.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">It is added to the history once someone with approval permission approves it with their PIN.</p>
            <label className="mt-3 block">
              New revision{current ? ` (current REV ${current})` : ""}
              <input className="mt-1 block w-32 rounded border border-border bg-background px-2 py-1" maxLength={MAX_REVISION} value={newRevision} onChange={(event) => setNewRevision(event.target.value)} aria-label="New revision" />
            </label>
            {newRevision.trim() && revisionProblem ? <p role="alert" className="text-xs text-destructive">{revisionProblem}</p> : null}
            <label className="mt-3 block">
              What changed
              <textarea className="mt-1 h-20 w-full rounded border border-border bg-background px-2 py-1" value={description} onChange={(event) => setDescription(event.target.value)} aria-label="What changed" />
            </label>
            <div className="mt-3 flex gap-2">
              <button type="button" className="rounded bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50" disabled={!startReady || start.isPending} onClick={() => start.mutate()}>Submit for approval</button>
              <button type="button" className="text-primary" onClick={() => setStarting(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {decision && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6" onClick={() => setDecision(null)}>
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-xl" onClick={(event) => event.stopPropagation()} role="dialog" aria-labelledby="decide-revision-title">
            <h2 id="decide-revision-title" className="text-sm font-medium">{decision === "approve" ? `Approve REV ${data.pendingRevision}` : `Reject REV ${data.pendingRevision}`}</h2>
            <label className="mt-3 block">
              {decision === "approve" ? "Note (optional)" : "Note (required)"}
              <textarea className="mt-1 h-16 w-full rounded border border-border bg-background px-2 py-1" value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            {decision === "approve" ? <ApprovalSignatureFields pin={pin} certified={certified} onPin={setPin} onCertified={setCertified} /> : null}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="rounded bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
                disabled={decide.isPending || (decision === "approve" ? !approvalReady(pin, certified) : note.trim() === "")}
                onClick={() => decide.mutate(decision)}
              >
                {decision === "approve" ? "Sign and approve" : "Reject"}
              </button>
              <button type="button" className="text-primary" onClick={() => setDecision(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
