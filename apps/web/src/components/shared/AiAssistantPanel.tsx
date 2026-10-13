import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bot, Copy, Move, Send, X } from "lucide-react";
import { apiClient } from "../../api/client";
import { useAuthStore } from "../../store/authStore";
import { useAssistantContextStore } from "../../store/assistantContextStore";
import { useAiFeaturesEnabled, useAssistantName } from "../../hooks/useAssistantName";
import { useToast } from "./ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { MarkdownLite } from "./MarkdownLite";
import type { AssistantReply } from "../../api/types";
import { clampToViewport, fabStorageKey, loadFabPosition, movedPastThreshold, saveFabPosition, type FloatPoint } from "../../lib/floatingPosition";

const FAB_SIZE = { width: 56, height: 56 };

function viewportSize() {
  return { width: window.innerWidth, height: window.innerHeight };
}

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
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const storageKey = fabStorageKey(userId);
  // null = the default bottom-right corner. Otherwise the button's top-left, in px.
  const [position, setPosition] = useState<FloatPoint | null>(null);
  const drag = useRef<{ pointerId: number; start: FloatPoint; origin: FloatPoint; moved: boolean; last?: FloatPoint } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    const saved = loadFabPosition(storageKey);
    setPosition(saved ? clampToViewport(saved, FAB_SIZE, viewportSize()) : null);
  }, [storageKey]);

  useEffect(() => {
    function onResize() {
      setPosition((current) => (current ? clampToViewport(current, FAB_SIZE, viewportSize()) : current));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const resetPosition = useCallback(() => {
    setPosition(null);
    saveFabPosition(storageKey, null);
  }, [storageKey]);

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    suppressClick.current = false;
    const rect = event.currentTarget.getBoundingClientRect();
    drag.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: { x: rect.left, y: rect.top }, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    const now = { x: event.clientX, y: event.clientY };
    if (!d.moved && !movedPastThreshold(d.start, now)) return;
    d.moved = true;
    const next = clampToViewport({ x: d.origin.x + now.x - d.start.x, y: d.origin.y + now.y - d.start.y }, FAB_SIZE, viewportSize());
    d.last = next;
    setPosition(next);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (d.moved) {
      suppressClick.current = true;
      if (d.last) saveFabPosition(storageKey, d.last);
    }
  }

  const { data: assistantNameRaw } = useAssistantName();
  const assistantName = assistantNameRaw || "the Assistant";

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
        type="button"
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          setIsOpen(true);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label={`Chat with ${assistantName}`}
        title={`Chat with ${assistantName} (drag to move)`}
        data-testid="ai-assistant-fab"
        style={position ? { left: position.x, top: position.y, touchAction: "none" } : { touchAction: "none" }}
        className={`fixed z-40 flex h-14 w-14 cursor-grab touch-none select-none items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:opacity-90 active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${position ? "" : "bottom-6 right-6"}`}
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
        <div className="flex items-center gap-1">
          {position && (
            <button type="button" onClick={resetPosition} className="rounded-md p-1 hover:bg-muted" aria-label="Reset button position" title="Reset position">
              <Move size={16} />
            </button>
          )}
          <button onClick={() => setIsOpen(false)} className="rounded-md p-1 hover:bg-muted" aria-label="Close assistant">
            <X size={18} />
          </button>
        </div>
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
                  aria-label="Copy reply"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:text-foreground"
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

/** Only renders once a user is signed in — POST /ai/assistant and GET /company/assistant-name both require a signed-in user. */
export function AiAssistantPanelGate() {
  const signedIn = useAuthStore((s) => s.user != null);
  const aiOn = useAiFeaturesEnabled();
  if (!signedIn || !aiOn) return null;
  return <AiAssistantPanel />;
}
