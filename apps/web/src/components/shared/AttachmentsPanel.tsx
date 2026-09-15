import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Download, Trash2 } from "lucide-react";
import { apiClient } from "../../api/client";
import { useCurrentUser } from "../../hooks/useAuth";
import { useToast } from "./ToastProvider";
import { extractErrorMessageAsync } from "../../hooks/useWorkflowAction";
import type { Attachment } from "../../api/types";

function formatSize(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * ONE reusable "Evidence / Attachments" panel — upload/list/download/delete
 * real files against the generic attachments table (see attachments.ts's
 * own schema comment), embedded on every real record's own detail page.
 * Pass entityType+entityId for a specific record (an NCR, an 8D, a
 * Feasibility Review, ...); omit both for the shared "General Uploads" bin
 * (a user's own documents not tied to any record).
 */
export function AttachmentsPanel({ entityType, entityId, title = "Evidence / Attachments" }: { entityType?: string; entityId?: number; title?: string }) {
  const toast = useToast();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const queryKey = ["attachments", entityType ?? null, entityId ?? null];
  const { data: files = [], isLoading } = useQuery<Attachment[]>({
    queryKey,
    queryFn: async () => (await apiClient.get("/attachments", { params: entityType && entityId ? { entityType, entityId } : undefined })).data,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file);
      if (entityType && entityId) {
        body.append("entityType", entityType);
        body.append("entityId", String(entityId));
      }
      return (await apiClient.post("/attachments", body, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("File uploaded.");
    },
    onError: async (err) => toast.error(await extractErrorMessageAsync(err, "Couldn't upload that file.")),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => apiClient.delete(`/attachments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Attachment deleted.");
    },
    onError: async (err) => toast.error(await extractErrorMessageAsync(err, "Couldn't delete that attachment.")),
  });

  async function download(file: Attachment) {
    try {
      const res = await apiClient.get(`/attachments/${file.id}/download`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(await extractErrorMessageAsync(err, "Couldn't download that file."));
    }
  }

  const isAdmin = user?.roleName === "admin" || user?.roleName === "platform_admin";

  return (
    <div className="rounded-lg border border-border bg-card p-4 print:hidden">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <Paperclip size={14} />
          {title}
        </h3>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={upload.isPending}
          className="rounded-md border border-primary px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-60"
        >
          {upload.isPending ? "Uploading…" : "Upload File"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = "";
          }}
        />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && files.length === 0 && <p className="text-sm text-muted-foreground">No files attached yet.</p>}

      <ul className="flex flex-col gap-1.5">
        {files.map((file) => (
          <li key={file.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{file.fileName}</div>
              <div className="text-xs text-muted-foreground">
                {formatSize(file.fileSize)} · {new Date(file.createdAt).toLocaleString()}
              </div>
            </div>
            <button onClick={() => download(file)} className="shrink-0 text-muted-foreground hover:text-foreground" title="Download">
              <Download size={16} />
            </button>
            {(isAdmin || file.uploadedBy === user?.id) && (
              <button onClick={() => remove.mutate(file.id)} className="shrink-0 text-muted-foreground hover:text-destructive" title="Delete">
                <Trash2 size={16} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
