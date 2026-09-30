import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { apiClient } from "../../api/client";
import { useVersioning, type VersionSummary } from "../../api/versioning";
import type { DocumentVersion } from "../../api/types";
import { VersionStatusBadge } from "../versioning/VersionParts";
import { WorkflowHistoryPanel } from "../shared/WorkflowHistoryPanel";
import { versionActivityLine, versionRevisionNote } from "../../lib/documentRevision";

/** A released file is either an already-hosted link or a stored file streamed via GET /documents/version/:versionId/file. */
async function downloadReleasedFile(version: DocumentVersion) {
  if (version.fileUrl && /^https?:\/\//i.test(version.fileUrl)) {
    window.open(version.fileUrl, "_blank", "noopener,noreferrer");
    return;
  }
  const res = await apiClient.get(`/documents/version/${version.id}/file`, { responseType: "blob" });
  const url = URL.createObjectURL(res.data as Blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Version history for one document, plus its audit trail.
 * The list is the versioning engine (the same revisions as the Versions tab),
 * including a draft that has not been published. The release ledger
 * (GET /documents/:id/history) only supplies a download for a file that was
 * stored when a version was published — an empty ledger is not "no versions".
 */
export function DocumentHistoryPanel({ documentId }: { documentId: number }) {
  const versioning = useVersioning("/documents", documentId);
  const versions = versioning.versions.data ?? [];
  const { data: ledger = [] } = useQuery<DocumentVersion[]>({
    queryKey: ["document", documentId, "release-ledger"],
    queryFn: async () => (await apiClient.get(`/documents/${documentId}/history`)).data,
  });

  const ledgerByVersion = new Map(ledger.map((row) => [row.version, row]));
  const engineNumbers = new Set(versions.map((version) => version.versionNumber));
  const unmatchedLedger = ledger.filter((row) => !engineNumbers.has(row.version)).sort((a, b) => b.version - a.version);
  const loading = versioning.versions.isLoading;
  const failed = versioning.versions.isError;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium">Version history</h3>
        <p className="mb-3 mt-1 text-xs text-muted-foreground">Same revisions as the Versions tab, including drafts that are not released yet.</p>
        {loading && <p className="text-sm text-muted-foreground">Loading version history…</p>}
        {failed && <p className="text-sm text-destructive">Couldn't load version history. Refresh the page and try again.</p>}
        {!loading && !failed && (
          <ul className="flex flex-col gap-2 text-sm">
            {versions.length === 0 && unmatchedLedger.length === 0 && <li className="text-muted-foreground">No versions yet.</li>}
            {versions.map((version) => (
              <HistoryRow key={version.id} version={version} releasedFile={ledgerByVersion.get(version.versionNumber)} />
            ))}
          </ul>
        )}
        {unmatchedLedger.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <h4 className="text-sm font-medium">Released files</h4>
            <p className="mb-2 mt-1 text-xs text-muted-foreground">Files stored when a revision was published. This is not a second version list.</p>
            <ul className="flex flex-col gap-2 text-sm">
              {unmatchedLedger.map((row) => (
                <li key={row.id} className="flex items-center gap-3 border-b border-border pb-2 last:border-0">
                  <span className="w-28 flex-none font-medium">Version {row.version}</span>
                  <span className="flex-1 text-muted-foreground">{row.changeNotes ?? "Released file"}</span>
                  <span className="flex-none text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleDateString()}</span>
                  {row.fileUrl && (
                    <button onClick={() => downloadReleasedFile(row)} className="flex-none text-primary hover:opacity-80" aria-label={`Download released file for version ${row.version}`}>
                      <FileText size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <WorkflowHistoryPanel moduleName="documents" recordId={documentId} title="Audit Trail" />
    </div>
  );
}

function HistoryRow({ version, releasedFile }: { version: VersionSummary; releasedFile?: DocumentVersion }) {
  const note = versionRevisionNote(version);
  const summary = typeof version.metadata?.summary === "string" ? version.metadata.summary : null;
  return (
    <li className="flex flex-col gap-1 border-b border-border pb-2 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Version {version.versionNumber}</span>
        <VersionStatusBadge status={version.status} />
        {note && <span className="text-muted-foreground">{note}</span>}
        {releasedFile?.fileUrl && (
          <button onClick={() => downloadReleasedFile(releasedFile)} className="ml-auto flex-none text-primary hover:opacity-80" aria-label={`Download released file for version ${version.versionNumber}`}>
            <FileText size={14} />
          </button>
        )}
      </div>
      {summary && <p className="text-xs">{summary}</p>}
      <p className="text-xs text-muted-foreground">{versionActivityLine(version)}</p>
      {releasedFile?.approvedAt && (
        <p className="text-xs text-muted-foreground">
          Approved {new Date(releasedFile.approvedAt).toLocaleDateString()}
          {releasedFile.approvalNotes && ` — ${releasedFile.approvalNotes}`}
        </p>
      )}
    </li>
  );
}
