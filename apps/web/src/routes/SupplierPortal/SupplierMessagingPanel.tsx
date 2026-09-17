import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useCurrentUser } from "../../hooks/useAuth";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { AiStructuredSuggestion } from "../../components/shared/AiStructuredSuggestion";
import type { SupplierMessage } from "../../api/types";

interface SupplierMessageDraft {
  subject: string;
  body: string;
  tone: "informational" | "corrective_action_request" | "escalation";
}

/** Threaded messaging between internal staff and one supplier — real read receipts (readAt gets stamped the moment the OTHER side's messages are fetched, see supplierPortal.controller.ts's getThreadHandler). One "general" thread per supplier for now; threadKey is there for future named threads. */
export function SupplierMessagingPanel({ supplierId }: { supplierId?: number }) {
  const toast = useToast();
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [draftSubject, setDraftSubject] = useState("");
  const [category, setCategory] = useState<"message" | "follow_up" | "request" | "response">("message");
  // Phase 7 task 3 — "AI-drafted" tag: only true immediately after accepting
  // an AI draft, cleared the moment the user edits the body afterward (never
  // mislabel edited content as purely AI-generated).
  const [aiDrafted, setAiDrafted] = useState(false);
  const isSupplier = currentUser?.roleName === "supplier";

  function resetComposer() {
    setBody("");
    setDraftSubject("");
    setAiDrafted(false);
    setCategory("message");
  }

  const queryKey = ["supplier-portal/messages/thread", supplierId ?? "self"];
  const { data: messages = [], isLoading } = useQuery<SupplierMessage[]>({
    queryKey,
    queryFn: async () => (await apiClient.get("/supplier-portal/messages/thread", { params: supplierId ? { supplierId } : undefined })).data,
    refetchInterval: 15000,
  });

  const send = useMutation({
    mutationFn: async () => (await apiClient.post("/supplier-portal/messages/send", { supplierId, body, category, aiDrafted })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      resetComposer();
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't send this message.")),
  });

  // Phase 5 — "email templates integrate with Phase 1 email infrastructure":
  // a real email to the supplier's own contactEmail (via
  // notification.service.ts's sendEmail), for reaching them outside the
  // portal — not just another in-app thread message.
  const sendEmail = useMutation({
    mutationFn: async () => (await apiClient.post("/supplier-portal/messages/send-email", { supplierId, subject: draftSubject, body, category, aiDrafted })).data,
    onSuccess: (data: { emailStatus: "sent" | "logged_only" | "failed" }) => {
      queryClient.invalidateQueries({ queryKey });
      resetComposer();
      if (data.emailStatus === "sent") toast.success("Email sent to the supplier.");
      else if (data.emailStatus === "logged_only") toast.success("Email logged — no SMTP provider configured for this environment.");
      else toast.error("Couldn't deliver the email after retrying — it's logged in the thread below.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't send this email.")),
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Messages</h3>
        {!isSupplier && (
          <AiStructuredSuggestion<SupplierMessageDraft>
            endpoint="/ai/supplier-message-draft"
            title="Draft a Supplier Message"
            triggerLabel="Draft with AI"
            acceptLabel="Use This Draft"
            buildPayload={() => ({
              supplierId,
              input: { recentMessages: messages.slice(-5).map((m) => ({ from: m.senderRole, body: m.body })) },
            })}
            onAccept={(output) => {
              setDraftSubject(output.subject);
              setBody(output.body);
              setAiDrafted(true);
            }}
            renderPreview={(output) => (
              <div className="flex flex-col gap-3 text-sm">
                <p>
                  <span className="text-xs font-medium text-muted-foreground">Subject:</span> {output.subject}
                </p>
                <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-2">{output.body}</p>
                <p className="text-xs text-muted-foreground">Tone: {output.tone.replace(/_/g, " ")}</p>
              </div>
            )}
          />
        )}
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">No messages yet — start the conversation below.</p>
      ) : (
        <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto">
          {messages.map((m) => {
            const isMine = (m.senderRole === "supplier") === isSupplier;
            return (
              <li key={m.id} className={`max-w-[80%] rounded-md p-2 text-sm ${isMine ? "self-end bg-primary text-primary-foreground" : "self-start bg-muted"}`}>
                <p>{m.body}</p>
                <p className={`mt-1 flex flex-wrap items-center gap-1 text-xs ${isMine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                  {m.senderRole === "supplier" ? "Supplier" : "AccuQual"} · {new Date(m.createdAt).toLocaleString()}
                  {m.readAt && " · Read"}
                  {m.category !== "message" && <span className="rounded-full border border-current/30 px-1.5 py-0.5 capitalize">{m.category.replace("_", " ")}</span>}
                  {m.aiDrafted && <span className="rounded-full border border-current/30 px-1.5 py-0.5">AI-drafted</span>}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        {!isSupplier && (
          <input
            value={draftSubject}
            onChange={(e) => setDraftSubject(e.target.value)}
            placeholder="Subject (only used when sending as an email)"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        )}
        <div className="flex gap-2">
          {!isSupplier && (
            <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className="rounded-md border border-border bg-background px-2 py-2 text-sm">
              <option value="message">Message</option>
              <option value="follow_up">Follow-up</option>
              <option value="request">Request</option>
              <option value="response">Response</option>
            </select>
          )}
          <input
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setAiDrafted(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && body.trim() && send.mutate()}
            placeholder="Type a message…"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button onClick={() => send.mutate()} disabled={!body.trim() || send.isPending} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            Send
          </button>
          {!isSupplier && (
            <button
              onClick={() => sendEmail.mutate()}
              disabled={!body.trim() || !draftSubject.trim() || sendEmail.isPending}
              title={!draftSubject.trim() ? "Add a subject above to send this as an email" : undefined}
              className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              {sendEmail.isPending ? "Sending…" : "Send as Email"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
