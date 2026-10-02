import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

export interface DocumentComment {
  id: number;
  documentId: number | null;
  folderId: number | null;
  versionId: number | null;
  versionNumber: number | null;
  body: string;
  authorId: number | null;
  authorName: string;
  createdAt: string | null;
}

/**
 * A short comment thread on a controlled document or a folder file.
 * Who and when come from the server. The company database keeps the rows.
 */
export function DocumentCommentThread({
  documentId,
  folderId,
  versionId,
  versionLabel,
  canComment,
}: {
  documentId?: number;
  folderId?: number;
  versionId?: number | null;
  versionLabel?: string | null;
  canComment: boolean;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const path = documentId ? `/documents/${documentId}/comments` : `/document-folders/${folderId}/comments`;
  const queryKey = ["document-comments", documentId ?? null, folderId ?? null];
  const { data, isLoading, isError } = useQuery<{ comments: DocumentComment[] }>({
    queryKey,
    queryFn: async () => (await apiClient.get(path)).data,
    enabled: Boolean(documentId || folderId),
  });
  const save = useMutation({
    mutationFn: async (body: string) => (await apiClient.post(path, { body, versionId: versionId ?? undefined })).data as { comment: DocumentComment },
    onSuccess: async () => {
      setDraft("");
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save that comment.")),
  });

  const comments = data?.comments ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium">Comments</h3>
        <p className="text-xs text-muted-foreground">
          Notes stay with this {documentId ? "document" : "file"}
          {versionLabel ? `. A new note is tagged to ${versionLabel}` : ""}.
        </p>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Loading comments…</p>}
      {isError && <p className="text-sm text-destructive">Couldn't load comments.</p>}
      {!isLoading && comments.length === 0 && <p className="text-sm text-muted-foreground">No comments yet.</p>}
      <ul className="flex flex-col gap-2">
        {comments.map((comment) => (
          <li key={comment.id} className="rounded-md border border-border px-3 py-2 text-sm">
            <p className="whitespace-pre-wrap">{comment.body}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {comment.authorName}
              {comment.createdAt ? ` · ${new Date(comment.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}
              {comment.versionNumber ? ` · version ${comment.versionNumber}` : ""}
            </p>
          </li>
        ))}
      </ul>
      {canComment && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const body = draft.trim();
            if (!body || save.isPending) return;
            save.mutate(body);
          }}
        >
          <label className="text-xs font-medium" htmlFor="document-comment">
            Add a comment
          </label>
          <textarea
            id="document-comment"
            value={draft}
            maxLength={2000}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-20 rounded-md border border-border bg-background p-2 text-sm"
            placeholder="What should the next reader know?"
          />
          <div>
            <button type="submit" disabled={save.isPending || !draft.trim()} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {save.isPending ? "Saving…" : "Comment"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
