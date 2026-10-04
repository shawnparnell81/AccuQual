import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { useToast } from "../shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { SaveAsFolderDialog } from "../forms/SaveAsFolderDialog";
import type { BrowseFolder } from "../../lib/folderBrowse";

export interface StoredExport {
  exportId: string;
  recordNumber: string;
  revision: string;
  status: string | null;
  exportedAt: string;
  checksumMatches: boolean;
  generatedBy: string;
  sha256: string;
  size: number;
  mime: string;
  renderer: string;
  sourceModule: string;
  entityType: string | null;
  entityId: number | null;
  legalHold: boolean;
  documentId: number | null;
  folderId: number | null;
  attachmentId: number | null;
  canAttach: boolean;
}

export function useStoredExport(exportId: string | null) {
  return useQuery({
    queryKey: ["pdf-export", exportId],
    enabled: Boolean(exportId),
    queryFn: async () => (await apiClient.get<StoredExport>(`/pdf-exports/${exportId}`)).data,
  });
}

/** File the stored PDF, attach it to the source record, or place a legal hold. */
export function PdfExportActions({ exportId, entityType, entityId }: { exportId: string | null; entityType?: string | null; entityId?: number | null }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { effective } = useEffectivePermissions();
  const stored = useStoredExport(exportId);
  const [picker, setPicker] = useState(false);
  const canHold = effective?.legal_hold === "edit";
  const canFile = effective?.documents === "edit";
  const folders = useQuery({
    queryKey: ["document-folders"],
    enabled: picker,
    queryFn: async () => (await apiClient.get<BrowseFolder[]>("/document-folders")).data,
  });

  const file = useMutation({
    mutationFn: async (folderId: number) => (await apiClient.post(`/pdf-exports/${exportId}/file`, { folderId })).data as { documentId: number; folderId: number },
    onSuccess: async (saved) => {
      setPicker(false);
      toast.success("Filed into Document Control.");
      await queryClient.invalidateQueries({ queryKey: ["pdf-export", exportId] });
      await queryClient.invalidateQueries({ queryKey: ["document-folders"] });
      return saved;
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't file that PDF.")),
  });

  const attach = useMutation({
    mutationFn: async () => (await apiClient.post(`/pdf-exports/${exportId}/attach`)).data,
    onSuccess: async () => {
      toast.success("Attached to this record.");
      await queryClient.invalidateQueries({ queryKey: ["pdf-export", exportId] });
      await queryClient.invalidateQueries({ queryKey: ["attachments"] });
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't attach that PDF.")),
  });

  const hold = useMutation({
    mutationFn: async (release: boolean) => {
      const body = { entityType: stored.data?.entityType ?? entityType, entityId: stored.data?.entityId ?? entityId };
      if (release) return (await apiClient.post("/legal-holds/release", body)).data;
      return (await apiClient.post("/legal-holds", body)).data;
    },
    onSuccess: async () => {
      toast.success(stored.data?.legalHold ? "Legal hold released." : "Legal hold placed.");
      await queryClient.invalidateQueries({ queryKey: ["pdf-export", exportId] });
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't change the legal hold.")),
  });

  if (!exportId) return null;
  const row = stored.data;
  const held = row?.legalHold === true;
  const recordId = row?.entityId ?? entityId;
  const showAttach = row ? row.canAttach : recordId != null && (entityType ?? "") !== "quality_report";

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/verify/${exportId}`} className="text-primary hover:underline">
          Export {exportId}
        </Link>
        {row?.checksumMatches === false && <span className="text-destructive">Stored file does not match its checksum.</span>}
        {held && <span className="font-medium">Record under legal hold</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {canFile && (
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted" onClick={() => setPicker(true)}>
            File into Document Control
          </button>
        )}
        {showAttach && (
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted" disabled={attach.isPending} onClick={() => attach.mutate()}>
            Attach to this record
          </button>
        )}
        {canHold && recordId != null && (
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted" disabled={hold.isPending} onClick={() => hold.mutate(held)}>
            {held ? "Release legal hold" : "Place legal hold"}
          </button>
        )}
      </div>
      {row?.documentId != null && (
        <Link to={`/documents/${row.documentId}`} className="text-xs text-primary hover:underline">
          Open the controlled document
        </Link>
      )}
      {picker && (
        <SaveAsFolderDialog
          folders={(folders.data ?? []).map((folder) => ({ ...folder, sortOrder: folder.sortOrder ?? 0 }))}
          selectedId=""
          pending={file.isPending}
          onClose={() => setPicker(false)}
          onSave={(folderId) => file.mutate(folderId)}
        />
      )}
    </div>
  );
}
