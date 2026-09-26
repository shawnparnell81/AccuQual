import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Upload } from "lucide-react";
import { apiClient } from "../../api/client";
import { uploadAttachment, type DocumentPayload } from "../../api/documents";
import type { CurrentState } from "../../api/versioning";
import type { AccuQualDocument } from "../../api/types";
import { isOfficeFileName } from "../../api/onlyoffice";
import { DOCUMENT_FOLDER_PAGES } from "../../components/layout/sidebarStructure";
import { OnlyOfficeEditor } from "../../components/documents/OnlyOfficeEditor";
import { PdfViewer } from "../../components/forms/PdfViewer";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { formatDate } from "../../lib/dates";

interface PreviewState {
  title: string;
  kind: "pdf" | "image" | "office" | "none";
  bytes: Uint8Array | null;
  imageUrl: string | null;
  office: { documentId: number; versionId: number; fileId: number; fileName: string } | null;
  note: string | null;
}

const emptyPreview: PreviewState = { title: "", kind: "none", bytes: null, imageUrl: null, office: null, note: null };

/**
 * A single document folder (Drawings, Master Tool List, Shipping, and the other
 * entries that don't have their own module). Files are real controlled documents
 * in that category, with the same upload and ONLYOFFICE/PDF preview the document
 * library already uses.
 */
export function DocumentCategoryPage() {
  const { category = "" } = useParams();
  const page = DOCUMENT_FOLDER_PAGES[category];
  const toast = useToast();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewState>(emptyPreview);
  const [previewLoading, setPreviewLoading] = useState(false);

  const documents = useQuery<AccuQualDocument[]>({
    queryKey: ["documents", undefined],
    queryFn: async () => (await apiClient.get<AccuQualDocument[]>("/documents")).data,
    enabled: !!page,
  });

  if (!page) {
    return <p className="text-sm text-muted-foreground">This folder isn't part of the menu.</p>;
  }

  const rows = (documents.data ?? []).filter((doc) => doc.category === category && doc.status !== "obsolete") as (AccuQualDocument & { createdAt?: string | null })[];

  async function upload(file: File) {
    setBusy(true);
    try {
      const created = await apiClient.post<AccuQualDocument>("/documents", { title: file.name, category });
      const current = await apiClient.get<CurrentState<DocumentPayload>>(`/documents/${created.data.id}/version/current`);
      const versionId = current.data.open?.id;
      if (!versionId) throw new Error("No draft to attach the file to.");
      await uploadAttachment(created.data.id, versionId, file);
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("File uploaded.");
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't upload that file."));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function openPreview(doc: AccuQualDocument) {
    setPreviewLoading(true);
    setPreview({ ...emptyPreview, title: doc.title });
    try {
      const current = await apiClient.get<CurrentState<DocumentPayload>>(`/documents/${doc.id}/version/current`);
      const version = current.data.open ?? current.data.published;
      const file = version?.payload?.attachments?.[0];
      if (!version || !file) {
        setPreview({ ...emptyPreview, title: doc.title, kind: "none", note: "This document doesn't have a file to preview yet." });
        return;
      }
      if (isOfficeFileName(file.fileName)) {
        setPreview({
          title: doc.title,
          kind: "office",
          bytes: null,
          imageUrl: null,
          office: { documentId: doc.id, versionId: version.id, fileId: file.id, fileName: file.fileName },
          note: null,
        });
        return;
      }
      const link = await apiClient.get<{ url: string }>(`/documents/${doc.id}/version/${version.id}/attachments/${file.id}/url`);
      const base = apiClient.defaults.baseURL ?? "";
      const res = await apiClient.get<ArrayBuffer>(`${base}${link.data.url}`, { responseType: "arraybuffer" });
      const bytes = new Uint8Array(res.data);
      if (file.mimeType === "application/pdf" || file.fileName.toLowerCase().endsWith(".pdf")) {
        setPreview({ title: doc.title, kind: "pdf", bytes, imageUrl: null, office: null, note: null });
        return;
      }
      if (file.mimeType?.startsWith("image/")) {
        const blob = new Blob([bytes], { type: file.mimeType });
        setPreview({ title: doc.title, kind: "image", bytes: null, imageUrl: URL.createObjectURL(blob), office: null, note: null });
        return;
      }
      setPreview({ ...emptyPreview, title: doc.title, kind: "none", note: "Open this file from Documents to download it. Preview here covers PDF, images, Word, and Excel." });
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't open a preview."));
      setPreview(emptyPreview);
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{page.title}</h1>
          <p className="text-sm text-muted-foreground">{page.blurb}</p>
        </div>
        <div>
          <input
            ref={input}
            type="file"
            className="hidden"
            accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg,.gif,.webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 ${
              page.emphasizeUpload ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"
            }`}
          >
            <Upload size={16} />
            {busy ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>

      {documents.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {documents.isError && <p className="text-sm text-destructive">Couldn't load this folder. Refresh the page and try again.</p>}
      {!documents.isLoading && !documents.isError && rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No files in this folder yet. Use Upload to add one.</div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">File</th>
                <th className="px-3 py-2 font-medium">Updated</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((doc) => (
                <tr key={doc.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{doc.title}</td>
                  <td className="px-3 py-2 text-muted-foreground">{doc.createdAt || doc.updatedAt ? formatDate(doc.createdAt ?? doc.updatedAt) : ""}</td>
                  <td className="px-3 py-2 capitalize text-muted-foreground">{doc.status.replace(/_/g, " ")}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => void openPreview(doc)} className="inline-flex items-center gap-1 text-primary hover:underline">
                      <Eye size={14} /> Preview
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(previewLoading || preview.title) && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-medium">{preview.title || "Preview"}</h2>
          {previewLoading && <p className="text-sm text-muted-foreground">Opening preview…</p>}
          {!previewLoading && preview.kind === "pdf" && <PdfViewer data={preview.bytes} isLoading={false} />}
          {!previewLoading && preview.kind === "image" && preview.imageUrl && <img src={preview.imageUrl} alt={preview.title} className="max-h-[70vh] max-w-full rounded-md border border-border" />}
          {!previewLoading && preview.kind === "office" && preview.office && (
            <OnlyOfficeEditor
              documentId={preview.office.documentId}
              versionId={preview.office.versionId}
              fileId={preview.office.fileId}
              fileName={preview.office.fileName}
              onClose={() => setPreview(emptyPreview)}
            />
          )}
          {!previewLoading && preview.note && <p className="text-sm text-muted-foreground">{preview.note}</p>}
        </section>
      )}
    </div>
  );
}
