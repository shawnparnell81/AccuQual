import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles, TriangleAlert, Check, X as XIcon } from "lucide-react";
import { apiClient } from "../../api/client";
import { Modal } from "../modals/Modal";
import { useAssistantName } from "../../hooks/useAssistantName";
import { useToast } from "./ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

type AiOutputStatus = "ok" | "stub" | "malformed" | "error";

interface StructuredSuggestionReply<T> {
  id: number;
  status: AiOutputStatus;
  errorMessage: string | null;
  output: T;
}

interface AiStructuredSuggestionProps<T> {
  /** POST endpoint for one of Phase 4/5's dedicated pipelines (e.g. /ai/ncr-triage) — never a record-writing endpoint by itself; only `onAccept` (below) ever writes anything, and only when the user explicitly clicks Accept. */
  endpoint: string;
  /** Built fresh each time the dialog opens, from whatever's already on the page. */
  buildPayload: () => Record<string, unknown>;
  /** Renders the schema-validated read-only preview once status is "ok" — this is real, trustworthy data (validated server-side against the pipeline's own promised shape before it ever reached the client). Accept/Reject controls are added by this component itself, not the caller, so every module gets the exact same buttons/copy/behavior. */
  renderPreview: (output: T) => React.ReactNode;
  /** Called only when the user clicks Accept. Omit for a suggestion with no single field to apply to (e.g. Warranty triage, an Audit prep summary) — Accept still records the decision, it just has nothing to write. */
  onAccept?: (output: T) => void;
  acceptLabel?: string;
  triggerLabel: string;
  title: string;
}

/**
 * Phase 4/5's counterpart to AiFieldAssistant for structured (not free-text)
 * suggestions — NCR triage, NCR root cause, CAPA generation, Supplier
 * message drafting, Warranty triage, Audit prep. Each backend pipeline
 * validates its own response against a Zod schema (see ai.guardrails.ts)
 * before this component ever sees it, so "ok" here means genuinely
 * well-shaped data, not just "the provider replied something."
 *
 * Phase 5 standardization: every consumer gets the same Accept/Reject
 * buttons, confidence indicator (shown whenever the output has a numeric
 * `confidence` field — never fabricated for schemas that don't), loading
 * state, and error/stub/malformed copy — "consistent UX across all
 * modules" was Phase 5's own explicit task, not each page inventing its
 * own. This component still never writes anything itself: `onAccept` is
 * the caller's own normal field-setter/mutation, called only after the
 * user's own explicit click — same non-negotiable as AiFieldAssistant.
 * Every suggestion shown gets exactly one decision recorded
 * (POST /ai/suggestions/:id/decision) — Accept, Reject, or closing the
 * dialog without deciding (treated as a reject, not a silent accept).
 */
export function AiStructuredSuggestion<T>({
  endpoint,
  buildPayload,
  renderPreview,
  onAccept,
  acceptLabel = "Accept Suggestion",
  triggerLabel,
  title,
}: AiStructuredSuggestionProps<T>) {
  const toast = useToast();
  const { data: assistantNameRaw } = useAssistantName();
  const assistantName = assistantNameRaw || "AI";
  const [isOpen, setIsOpen] = useState(false);
  const decidedRef = useRef(false);

  const generate = useMutation({
    mutationFn: async () => (await apiClient.post<StructuredSuggestionReply<T>>(endpoint, buildPayload())).data,
    onError: (err) => toast.error(extractErrorMessage(err, "The assistant couldn't respond.")),
  });

  const decide = useMutation({
    mutationFn: async (decision: "accepted" | "rejected") => {
      if (!generate.data) return;
      await apiClient.post(`/ai/suggestions/${generate.data.id}/decision`, { decision });
    },
  });

  function open() {
    decidedRef.current = false;
    generate.reset();
    setIsOpen(true);
    generate.mutate();
  }

  function close() {
    // A real suggestion the user never explicitly decided on is treated as
    // rejected, not silently dropped — "must explicitly accept or reject."
    if (generate.data?.status === "ok" && !decidedRef.current) {
      decidedRef.current = true;
      decide.mutate("rejected");
    }
    setIsOpen(false);
  }

  function accept() {
    if (!generate.data) return;
    decidedRef.current = true;
    onAccept?.(generate.data.output);
    decide.mutate("accepted");
    toast.success("Suggestion accepted.");
    setIsOpen(false);
  }

  function reject() {
    decidedRef.current = true;
    decide.mutate("rejected");
    setIsOpen(false);
  }

  const reply = generate.data;
  const rawConfidence = reply?.status === "ok" ? (reply.output as Record<string, unknown>).confidence : undefined;
  const confidence = typeof rawConfidence === "number" ? rawConfidence : null;

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted"
      >
        <Sparkles className="h-3.5 w-3.5" />
        {triggerLabel}
      </button>

      <Modal isOpen={isOpen} onClose={close} title={title}>
        <div className="flex flex-col gap-3">
          {generate.isPending && <p className="text-sm text-muted-foreground">{assistantName} is thinking…</p>}

          {reply?.status === "stub" && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                No AI provider is configured for this company — the suggestion below is a placeholder, not a real answer, and can&apos;t
                be accepted. Configure a provider under Settings &rarr; Company AI Config to get real responses.
              </span>
            </div>
          )}

          {reply?.status === "malformed" && (
            <div className="flex items-start gap-2 rounded-md border border-dashed border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{reply.errorMessage ?? "The AI response didn't come back in the expected shape, so nothing is shown here."}</span>
            </div>
          )}

          {generate.isError && (
            <div className="flex items-start gap-2 rounded-md border border-dashed border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{extractErrorMessage(generate.error, "The AI provider request failed.")}</span>
            </div>
          )}

          {reply?.status === "ok" && (
            <>
              {confidence !== null && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Confidence</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground">{Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%</span>
                </div>
              )}

              {renderPreview(reply.output)}

              <div className="flex justify-end gap-2 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={reject}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  <XIcon className="h-3.5 w-3.5" />
                  Reject
                </button>
                <button
                  type="button"
                  onClick={accept}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                >
                  <Check className="h-3.5 w-3.5" />
                  {acceptLabel}
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
