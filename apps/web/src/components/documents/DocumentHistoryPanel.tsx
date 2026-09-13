import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { apiClient } from "../../api/client";
import { WorkflowHistoryPanel } from "../shared/WorkflowHistoryPanel";
import type { DocumentVersion } from "../../api/types";

/** A version's fileUrl is either an already-hosted link (the JSON `POST .../version` path) or a real uploaded file streamed via GET /documents/version/:versionId/file (auth required, so fetched as a blob rather than a plain link). */
async function downloadVersion(version: DocumentVersion) {
  if (version.fileUrl && /^https?:\/\//i.test(version.fileUrl)) {
    window.open(version.fileUrl, "_blank", "noopener,noreferrer");
    return;
  }
  const res = await apiClient.get(`/documents/version/${version.id}/file`, { responseType: "blob" });
  const url = URL.createObjectURL(res.data as Blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Every version of a document (form_data's versioning backbone for the schema-driven forms; document_versions here) plus its audit trail, in one place. */
export function DocumentHistoryPanel({ documentId }: { documentId: number }) {
  const { data: versions = [] } = useQuery<DocumentVersion[]>({
    queryKey: ["document", documentId, "history"],
    queryFn: async () => (await apiClient.get(`/documents/${documentId}/history`)).data,
  });

  const sortedVersions = [...versions].sort((a, b) => b.version - a.version);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Version History</h3>
        <ul className="flex flex-col gap-2 text-sm">
          {sortedVersions.length === 0 && <li className="text-muted-foreground">No versions yet.</li>}
          {sortedVersions.map((v) => (
            <li key={v.id} className="flex flex-col gap-1 border-b border-border pb-2 last:border-0">
              <div className="flex items-center gap-3">
                <span className="w-16 flex-none font-medium">Rev {v.version}</span>
                <span className="flex-1 text-muted-foreground">{v.changeNotes ?? "No change notes"}</span>
                <span className="flex-none text-xs text-muted-foreground">{new Date(v.createdAt).toLocaleDateString()}</span>
                {v.fileUrl && (
                  <button onClick={() => downloadVersion(v)} className="flex-none text-primary hover:opacity-80" aria-label={`Download revision ${v.version}`}>
                    <FileText size={14} />
                  </button>
                )}
              </div>
              {v.approvedAt && (
                <p className="pl-16 text-xs text-muted-foreground">
                  Approved {new Date(v.approvedAt).toLocaleDateString()}
                  {v.approvalNotes && ` — ${v.approvalNotes}`}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>

      <WorkflowHistoryPanel moduleName="documents" recordId={documentId} title="Audit Trail" />
    </div>
  );
}
