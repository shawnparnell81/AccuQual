import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessageAsync } from "../../hooks/useWorkflowAction";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { FileDropZone } from "../../components/shared/FileDropZone";

interface DocumentFolder {
  id: number;
  name: string;
  parentId: number | null;
}

const LIBRARY_POOL_NAME = "Library Pool";

/** Flattens the folder tree into one indented, depth-ordered list for a plain <select> — same tree shape FolderExplorerPage.tsx renders, just linearized. */
function flattenFolders(folders: DocumentFolder[]): { id: number; label: string }[] {
  const byParent = new Map<number | null, DocumentFolder[]>();
  for (const f of folders) {
    if (f.name === LIBRARY_POOL_NAME) continue;
    byParent.set(f.parentId, [...(byParent.get(f.parentId) ?? []), f]);
  }
  const result: { id: number; label: string }[] = [];
  function walk(parentId: number | null, depth: number) {
    for (const f of byParent.get(parentId) ?? []) {
      result.push({ id: f.id, label: `${"— ".repeat(depth)}${f.name}` });
      walk(f.id, depth + 1);
    }
  }
  walk(null, 0);
  return result;
}

/**
 * Upload flow with a real destination choice — per the user's explicit
 * requirement ("give the user an option on where to upload it to: Quality,
 * document library, engineering, etc"). Picking a real folder files the
 * document straight into the Document Library tree (the same one-step
 * create-a-leaf-and-attach action FolderExplorerPage.tsx's own "Upload
 * Document" button uses — see document-folders.controller.ts's
 * uploadDocument); leaving it on "General" uses the plain shared
 * attachments bin instead, for a file that genuinely isn't a controlled
 * document.
 */
export function GeneralUploadsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [folderId, setFolderId] = useState<string>("");

  const { data: folders = [] } = useQuery<DocumentFolder[]>({
    queryKey: ["document-folders"],
    queryFn: async () => (await apiClient.get("/document-folders")).data,
  });
  const folderOptions = useMemo(() => flattenFolders(folders), [folders]);

  const uploadToFolder = useMutation({
    mutationFn: async ({ file, parentId }: { file: File; parentId: number }) => {
      const body = new FormData();
      body.append("file", file);
      body.append("parentId", String(parentId));
      return (await apiClient.post("/document-folders/upload", body, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: (created: { id: number }) => {
      queryClient.invalidateQueries({ queryKey: ["document-folders"] });
      toast.success("Document uploaded to the library.");
      navigate(`/documents/folders?dept=${created.id}`);
    },
    onError: async (err) => toast.error(await extractErrorMessageAsync(err, "Couldn't upload that file.")),
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">General Uploads</h1>
        <p className="text-sm text-muted-foreground">Upload a real controlled document (a policy, a procedure, anything else) straight into the Document Library, or leave it here as a general file if it isn't tied to a folder or a specific record.</p>
      </div>

      <FileDropZone className="rounded-lg border border-border bg-card p-4" disabled={!folderId || uploadToFolder.isPending} multiple={false} label="Drop to upload to the library" onFiles={(dropped) => uploadToFolder.mutate({ file: dropped[0]!, parentId: Number(folderId) })}>
        <h3 className="mb-3 text-sm font-medium">Upload to Document Library</h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium uppercase text-muted-foreground">Destination Folder</span>
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className="w-64 rounded-md border border-form-field bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary">
              <option value="">Select a folder (Quality, Engineering, ...)</option>
              {folderOptions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!folderId || uploadToFolder.isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {uploadToFolder.isPending ? "Uploading…" : "Choose File & Upload"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && folderId) uploadToFolder.mutate({ file, parentId: Number(folderId) });
              e.target.value = "";
            }}
          />
        </div>
        {!folderId && <p className="mt-2 text-xs text-muted-foreground">Pick a folder above first — this is what makes it a real, findable controlled document instead of a loose file.</p>}
        {folderId && <p className="mt-2 text-xs text-muted-foreground">…or drag a file from your computer and drop it anywhere on this box.</p>}
      </FileDropZone>

      <AttachmentsPanel title="General Files (not filed to a folder)" />
    </div>
  );
}
