import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bot, Copy, Send, X } from "lucide-react";
import { apiClient } from "../../api/client";
import { useAuthStore } from "../../store/authStore";
import { useAssistantContextStore } from "../../store/assistantContextStore";
import { useToast } from "./ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { MarkdownLite } from "./MarkdownLite";
import type { AssistantNameResponse, AssistantReply } from "../../api/types";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Global floating AI Assistant — mounted once in AppLayout, present on every
 * authenticated page. Chat history is in-memory only for this component's
 * lifetime (per session, per "no persistence" scope decision); nothing is
 * saved server-side beyond the audit trail entry POST /ai/assistant already
 * writes per message. Read-only by construction: this panel has no mutation
 * anywhere that touches a real record, only the chat call itself.
 */
export function AiAssistantPanel() {
  const toast = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const context = useAssistantContextStore((s) => s.context);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: nameData } = useQuery<AssistantNameResponse>({
    queryKey: ["tenant/assistant-name"],
    queryFn: async () => (await apiClient.get("/tenant/assistant-name")).data,
  });
  const assistantName = nameData?.assistantName || "the Assistant";

  const send = useMutation({
    mutationFn: async (nextMessages: ChatMessage[]) =>
      (
        await apiClient.post<AssistantReply>("/ai/assistant", {
          messages: nextMessages,
          context: context ? { module: context.module, recordId: context.recordId } : undefined,
        })
      ).data,
    onSuccess: (reply) => setMessages((prev) => [...prev, { role: "assistant", content: reply.content }]),
    onError: (err) => toast.error(extractErrorMessage(err, "The assistant couldn't respond.")),
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, send.isPending]);

  function handleSend() {
    const text = draft.trim();
    if (!text || send.isPending) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setDraft("");
    send.mutate(next);
  }

  async function copyMessage(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      toast.success("Copied to clipboard.");
    } catch {
      toast.error("Couldn't copy — your browser blocked clipboard access.");
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        aria-label={`Chat with ${assistantName}`}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:opacity-90"
      >
        <Bot size={24} />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 flex h-[32rem] w-96 max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-border bg-card shadow-xl">
      <div className="flex items-center justify-between border-b border-border p-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold">Chat with {assistantName}</span>
          {context && <span className="text-xs text-muted-foreground">Viewing: {context.label}</span>}
        </div>
        <button onClick={() => setIsOpen(false)} className="rounded-md p-1 hover:bg-muted" aria-label="Close assistant">
          <X size={18} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ask {assistantName} to summarize what you're viewing, explain a field, or draft text — it can't change any record for
            you.
          </p>
        )}
        <div className="flex flex-col gap-3">
          {messages.map((m, i) => (
            <div key={i} className={`group flex flex-col gap-1 ${m.role === "user" ? "items-end" : "items-start"}`}>
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 ${
                  m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}
              >
                {m.role === "assistant" ? <MarkdownLite text={m.content} /> : <p className="text-sm">{m.content}</p>}
              </div>
              {m.role === "assistant" && (
                <button
                  onClick={() => copyMessage(m.content)}
                  className="flex items-center gap-1 text-xs text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
                >
                  <Copy size={12} /> Copy
                </button>
              )}
            </div>
          ))}
          {send.isPending && <p className="text-sm text-muted-foreground">{assistantName} is thinking…</p>}
        </div>
      </div>

      <div className="flex items-end gap-2 border-t border-border p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          rows={1}
          placeholder="Ask a question…"
          className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          onClick={handleSend}
          disabled={send.isPending || !draft.trim()}
          aria-label="Send"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-60"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}

/** Only renders once a tenant-scoped user is logged in — POST /ai/assistant and GET /tenant/assistant-name both require req.tenantId, which platform_admin (no tenant) never has. */
export function AiAssistantPanelGate() {
  const userTenantId = useAuthStore((s) => s.user?.tenantId);
  if (userTenantId == null) return null;
  return <AiAssistantPanel />;
}
