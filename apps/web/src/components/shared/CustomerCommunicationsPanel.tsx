import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "./ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { Modal } from "../modals/Modal";
import { TextField, TextAreaField, SelectField } from "../forms/Field";
import { AttachmentsPanel } from "./AttachmentsPanel";
import type { CustomerCommunication } from "../../api/types";

const COMMS_TYPES = ["phone", "email", "f2f", "portal"] as const;
const COMMS_TYPE_LABELS: Record<string, string> = { email: "Email", phone: "Phone", f2f: "Face to Face", portal: "Portal" };

/**
 * Real Customer Contact & Communications Log — closes the Buyer
 * Evaluation's "no way to log a conversation with a customer" finding.
 * Embedded on a record's own detail page exactly like AttachmentsPanel/
 * WorkflowHistoryPanel already are (see CustomerDetailPage.tsx) — NOT a
 * floating window. This app's multi-window system (see window-manager/)
 * has exactly one real caller anywhere (OpenFormButton, for the PDF
 * form-filling engine specifically); every other record type in this app,
 * including this one, is a real page/panel in the main content area.
 *
 * GET /customer-communications has no server-side customerId filter (the
 * backend is a plain crudFactory list) — client-filtered here, same
 * "fine at this data scale" pattern the NCR workspace's own linked-CAPA
 * list already uses for an equivalent one-to-many relationship.
 */
export function CustomerCommunicationsPanel({ customerId, title = "Communications Log" }: { customerId: number; title?: string }) {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const queryKey = ["customer-communications"];
  const { data: all = [], isLoading } = useQuery<CustomerCommunication[]>({
    queryKey,
    queryFn: async () => (await apiClient.get("/customer-communications")).data,
  });
  const communications = all.filter((c) => c.customerId === customerId).sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">{title}</h2>
        <button type="button" onClick={() => setCreateOpen(true)} className="rounded-md border border-primary px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10">
          + Log Communication
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : communications.length === 0 ? (
        <p className="text-sm text-muted-foreground">No communications logged yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {communications.map((c) => (
            <div key={c.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{COMMS_TYPE_LABELS[c.commsType] ?? c.commsType}</span>
                  <span className="text-muted-foreground">{new Date(c.occurredAt).toLocaleString()}</span>
                  {c.followUpRequired && (
                    <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                      Follow-up{c.followUpDate ? ` by ${new Date(c.followUpDate).toLocaleDateString()}` : ""}
                    </span>
                  )}
                </div>
                <button type="button" onClick={() => setExpandedId(expandedId === c.id ? null : c.id)} className="text-xs text-primary hover:underline">
                  {expandedId === c.id ? "Hide" : "Details"}
                </button>
              </div>
              {c.subject && <p className="mt-1 text-sm font-medium">{c.subject}</p>}
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{c.summary}</p>
              {c.sourceType && c.sourceId && <p className="mt-1 text-xs text-muted-foreground">Related: {c.sourceType} #{c.sourceId}</p>}

              {expandedId === c.id && (
                <div className="mt-3 border-t border-border pt-3">
                  <AttachmentsPanel entityType="CustomerCommunication" entityId={c.id} title="Attachments (email export, photos, signed PDF, ...)" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <CreateCommunicationModal customerId={customerId} isOpen={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => queryClient.invalidateQueries({ queryKey })} />
    </div>
  );
}

function CreateCommunicationModal({ customerId, isOpen, onClose, onCreated }: { customerId: number; isOpen: boolean; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [commsType, setCommsType] = useState<string>("phone");
  const [subject, setSubject] = useState("");
  const [summary, setSummary] = useState("");
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [followUpDate, setFollowUpDate] = useState("");

  const create = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post("/customer-communications", {
          customerId,
          commsType,
          subject: subject || undefined,
          summary,
          followUpRequired,
          followUpDate: followUpRequired && followUpDate ? followUpDate : undefined,
        })
      ).data,
    onSuccess: () => {
      toast.success("Communication logged.");
      onCreated();
      onClose();
      setSubject("");
      setSummary("");
      setFollowUpRequired(false);
      setFollowUpDate("");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't log this communication.")),
  });

  return (
    <Modal title="Log Customer Communication" isOpen={isOpen} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <SelectField label="Type" value={commsType} onChange={(e) => setCommsType(e.target.value)}>
          {COMMS_TYPES.map((t) => (
            <option key={t} value={t}>
              {COMMS_TYPE_LABELS[t]}
            </option>
          ))}
        </SelectField>
        <TextField label="Subject (optional)" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <TextAreaField label="Summary" value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} required />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={followUpRequired} onChange={(e) => setFollowUpRequired(e.target.checked)} />
          Follow-up required
        </label>
        {followUpRequired && <TextField label="Follow-up date" type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />}
        <p className="text-xs text-muted-foreground">Attach files (email export, photos, a signed PDF) after saving, from this entry's Details panel.</p>
        <button type="submit" disabled={create.isPending || !summary} className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {create.isPending ? "Saving…" : "Log Communication"}
        </button>
      </form>
    </Modal>
  );
}
