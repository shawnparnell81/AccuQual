import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useCurrentUser } from "../../hooks/useAuth";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import type { SupplierMessage } from "../../api/types";

/** Threaded messaging between internal staff and one supplier — real read receipts (readAt gets stamped the moment the OTHER side's messages are fetched, see supplierPortal.controller.ts's getThreadHandler). One "general" thread per supplier for now; threadKey is there for future named threads. */
export function SupplierMessagingPanel({ supplierId }: { supplierId?: number }) {
  const toast = useToast();
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const isSupplier = currentUser?.roleName === "supplier";

  const queryKey = ["supplier-portal/messages/thread", supplierId ?? "self"];
  const { data: messages = [], isLoading } = useQuery<SupplierMessage[]>({
    queryKey,
    queryFn: async () => (await apiClient.get("/supplier-portal/messages/thread", { params: supplierId ? { supplierId } : undefined })).data,
    refetchInterval: 15000,
  });

  const send = useMutation({
    mutationFn: async () => (await apiClient.post("/supplier-portal/messages/send", { supplierId, body })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setBody("");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't send this message.")),
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium">Messages</h3>
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
                <p className={`mt-1 text-xs ${isMine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                  {m.senderRole === "supplier" ? "Supplier" : "AccuQual"} · {new Date(m.createdAt).toLocaleString()}
                  {m.readAt && " · Read"}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex gap-2 border-t border-border pt-3">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && body.trim() && send.mutate()}
          placeholder="Type a message…"
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <button onClick={() => send.mutate()} disabled={!body.trim() || send.isPending} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          Send
        </button>
      </div>
    </div>
  );
}
