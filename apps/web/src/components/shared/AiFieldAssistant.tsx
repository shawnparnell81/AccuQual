import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { apiClient } from "../../api/client";
import { Modal } from "../modals/Modal";
import { TextAreaField } from "../forms/Field";
import { MarkdownLite } from "./MarkdownLite";
import { useAssistantName } from "../../hooks/useAssistantName";
import { useToast } from "./ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import type { AssistantReply } from "../../api/types";

interface AiFieldAssistantProps {
  /** Passed straight through as POST /ai/assistant's context.module — drives which module's real, read-only context the backend attaches (see ai.assistant.ts's loadContextSummary). */
  module: string;
  /** Omit when there's no record yet (e.g. an NCR still being created) — the backend still answers, just without record-specific context. */
  recordId?: number;
  /** Builds the editable starting prompt from whatever's already on the page (e.g. the NCR title the user just typed). Called fresh each time the dialog opens. */
  buildInitialPrompt: () => string;
  /** Given when the generated text has a real field to land in on THIS page — e.g. an NCR description textarea, a CAPA root cause field. Omitted for pages with no single target field (Audit Plan, Digital Twin), where Copy is the only action. */
  onInsert?: (text: string) => void;
  insertLabel?: string;
  /** Overrides the default "Generate with {assistantName}" trigger label. */
  triggerLabel?: string;
}

/**
 * The page-embedded counterpart to the global floating AiAssistantPanel.
 * That panel can't reach into a page's own form fields (its "Insert into
 * form" idea was dropped for exactly that reason — see the AI Assistant
 * module review). This component lives ON the page next to the field it
 * helps with, so when `onInsert` is given it really can hand the result
 * straight to that field's own setter — no cross-window plumbing needed.
 *
 * Still just a thin UI around the same POST /ai/assistant proxy: this
 * component never writes anything itself, it only ever calls the callback
 * its parent gave it, with the text the model returned.
 */
export function AiFieldAssistant({ module, recordId, buildInitialPrompt, onInsert, insertLabel = "Insert", triggerLabel }: AiFieldAssistantProps) {
  const toast = useToast();
  const { data: assistantNameRaw } = useAssistantName();
  const assistantName = assistantNameRaw || "AI";
  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const generate = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post<AssistantReply>("/ai/assistant", {
          messages: [{ role: "user", content: prompt }],
          context: recordId !== undefined ? { module, recordId } : { module },
        })
      ).data,
    onSuccess: (reply) => setResult(reply.content),
    onError: (err) => toast.error(extractErrorMessage(err, "The assistant couldn't respond.")),
  });

  function open() {
    setPrompt(buildInitialPrompt());
    setResult(null);
    setIsOpen(true);
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      toast.success("Copied to clipboard.");
    } catch {
      toast.error("Couldn't copy — your browser blocked clipboard access.");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
      >
        <Sparkles size={12} />
        {triggerLabel ?? `Generate with ${assistantName}`}
      </button>

      <Modal title={`Generate with ${assistantName}`} isOpen={isOpen} onClose={() => setIsOpen(false)}>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {assistantName} only suggests text — it can't change this record. Review anything below before using it.
          </p>
          <TextAreaField label="Prompt (edit before generating)" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} />
          <button
            type="button"
            onClick={() => generate.mutate()}
            disabled={generate.isPending || !prompt.trim()}
            className="w-fit rounded-md bg-button px-3 py-1.5 text-sm text-button-foreground disabled:opacity-60"
          >
            {generate.isPending ? "Generating…" : "Generate"}
          </button>

          {result && (
            <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-3">
              <MarkdownLite text={result} />
              <div className="flex gap-2">
                {onInsert && (
                  <button
                    type="button"
                    onClick={() => {
                      onInsert(result);
                      setIsOpen(false);
                    }}
                    className="rounded-md bg-button px-3 py-1.5 text-xs font-medium text-button-foreground"
                  >
                    {insertLabel}
                  </button>
                )}
                <button type="button" onClick={copy} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">
                  Copy to clipboard
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
