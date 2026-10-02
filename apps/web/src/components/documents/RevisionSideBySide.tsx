import { useEffect, useState } from "react";
import { fetchDocumentAttachment, type DocumentAttachmentRef, type DocumentPayload } from "../../api/documents";
import { useVersionPayload, type VersionSummary } from "../../api/versioning";
import { pairRevisionLines } from "../../lib/revisionLines";
import { previewKind } from "../../lib/filePreview";
import { PdfViewer } from "../forms/PdfViewer";

function pdfOf(files: DocumentAttachmentRef[] | undefined): DocumentAttachmentRef | null {
  return files?.find((file) => previewKind(file.fileName, file.mimeType) === "pdf") ?? null;
}

function earlierVersion(versionList: VersionSummary[], versionId: number, againstId: number | null): VersionSummary | undefined {
  if (againstId) return versionList.find((version) => version.id === againstId);
  const current = versionList.find((version) => version.id === versionId);
  if (!current) return undefined;
  return versionList
    .filter((version) => version.versionNumber < current.versionNumber)
    .sort((a, b) => b.versionNumber - a.versionNumber)[0];
}

/** Two revisions next to each other: text line by line, and the PDF when both sides have one. */
export function RevisionSideBySide({
  documentId,
  versionList,
  versionId,
  againstId,
}: {
  documentId: number;
  versionList: VersionSummary[];
  versionId: number;
  againstId: number | null;
}) {
  const leftMeta = earlierVersion(versionList, versionId, againstId);
  const rightMeta = versionList.find((version) => version.id === versionId);
  if (!leftMeta) return <p className="text-sm text-muted-foreground">This is the first revision, so there is nothing to put beside it.</p>;
  return (
    <SideBySidePanels
      documentId={documentId}
      leftId={leftMeta.id}
      rightId={versionId}
      leftLabel={`Version ${leftMeta.versionNumber}${leftMeta.revisionCode ? ` · ${leftMeta.revisionCode}` : ""}`}
      rightLabel={`Version ${rightMeta?.versionNumber ?? ""}${rightMeta?.revisionCode ? ` · ${rightMeta.revisionCode}` : ""}`}
    />
  );
}

function SideBySidePanels({
  documentId,
  leftId,
  rightId,
  leftLabel,
  rightLabel,
}: {
  documentId: number;
  leftId: number;
  rightId: number;
  leftLabel: string;
  rightLabel: string;
}) {
  const left = useVersionPayload<DocumentPayload>("/documents", documentId, leftId);
  const right = useVersionPayload<DocumentPayload>("/documents", documentId, rightId);
  const leftPdf = pdfOf(left.data?.payload?.attachments);
  const rightPdf = pdfOf(right.data?.payload?.attachments);
  const lines = pairRevisionLines(left.data?.payload?.content ?? "", right.data?.payload?.content ?? "");
  const changed = lines.some((line) => line.changed);

  if (left.isLoading || right.isLoading) return <p className="text-sm text-muted-foreground">Opening both revisions…</p>;
  if (left.isError || right.isError) return <p className="text-sm text-destructive">Couldn't open one of those revisions.</p>;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{changed ? "Highlighted lines are different." : "The written content matches."}</p>
      {(leftPdf || rightPdf) && (
        <div className="grid gap-3 lg:grid-cols-2">
          <PdfPane documentId={documentId} versionId={leftId} file={leftPdf} label={leftLabel} />
          <PdfPane documentId={documentId} versionId={rightId} file={rightPdf} label={rightLabel} />
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        <LinePane label={leftLabel} lines={lines.map((line) => line.left)} changed={lines.map((line) => line.changed)} />
        <LinePane label={rightLabel} lines={lines.map((line) => line.right)} changed={lines.map((line) => line.changed)} />
      </div>
    </div>
  );
}

function LinePane({ label, lines, changed }: { label: string; lines: string[]; changed: boolean[] }) {
  return (
    <section className="min-w-0 rounded-md border border-border">
      <h4 className="border-b border-border px-2 py-1.5 text-xs font-medium">{label}</h4>
      <div className="max-h-80 overflow-auto font-mono text-xs">
        {lines.length === 0 || lines.every((line) => !line) ? (
          <p className="px-2 py-3 text-muted-foreground">No written content.</p>
        ) : (
          lines.map((line, index) => (
            <div key={index} className={`whitespace-pre-wrap break-words px-2 py-0.5 ${changed[index] ? "bg-warning/15" : ""}`}>
              {line || " "}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function PdfPane({ documentId, versionId, file, label }: { documentId: number; versionId: number; file: DocumentAttachmentRef | null; label: string }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setBytes(null);
      return;
    }
    let cancelled = false;
    setError(null);
    void fetchDocumentAttachment(documentId, versionId, file.id)
      .then((got) => {
        if (!cancelled) setBytes(new Uint8Array(got.bytes));
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't open the PDF.");
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, file, versionId]);

  return (
    <section className="min-w-0 rounded-md border border-border">
      <h4 className="border-b border-border px-2 py-1.5 text-xs font-medium">{label} PDF</h4>
      <div className="max-h-[28rem] overflow-auto bg-muted/30 p-2">
        {!file && <p className="text-xs text-muted-foreground">No PDF on this revision.</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
        {file && !bytes && !error && <p className="text-xs text-muted-foreground">Opening PDF…</p>}
        {bytes && <PdfViewer data={bytes} isLoading={false} />}
      </div>
    </section>
  );
}
