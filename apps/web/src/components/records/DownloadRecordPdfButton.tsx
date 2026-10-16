import { useState } from "react";
import { FileDown } from "lucide-react";
import { useLocation } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { canPrintAccess, isPdfBytes, PRINT_NOT_DOCUMENT } from "../../lib/printDocument";
import { recordPdfSource } from "../../lib/recordPdf";
import { recordSurface } from "../../lib/recordSurface";
import { extractErrorMessageAsync } from "../../hooks/useWorkflowAction";
import { useToast } from "../shared/ToastProvider";

/**
 * Download PDF beside Print for records the API can render. Anyone who can
 * view the record can download it, the same rule as Print. It works while
 * the record is locked.
 */
export function DownloadRecordPdfButton() {
  const { pathname } = useLocation();
  const toast = useToast();
  const { effective, isLoading } = useEffectivePermissions();
  const [busy, setBusy] = useState(false);
  const source = recordPdfSource(pathname);
  if (!source) return null;
  const surface = recordSurface(pathname);
  const level = !surface || surface.access === "any" ? "any" : effective?.[surface.access];
  if (!isLoading && !canPrintAccess(level)) return null;

  async function download() {
    if (!source) return;
    setBusy(true);
    try {
      const response = source.method === "post"
        ? await apiClient.post(source.url, null, { responseType: "arraybuffer" })
        : await apiClient.get(source.url, { responseType: "arraybuffer" });
      const bytes = new Uint8Array(response.data as ArrayBuffer);
      if (!isPdfBytes(bytes)) throw new Error(PRINT_NOT_DOCUMENT);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = source.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      toast.error(err instanceof Error && err.message === PRINT_NOT_DOCUMENT ? err.message : await extractErrorMessageAsync(err, "Couldn't download this PDF."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      data-testid="download-record-pdf"
      data-lock-exempt
      disabled={busy}
      onClick={download}
      className="no-print inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
    >
      <FileDown size={16} /> {busy ? "Preparing…" : "Download PDF"}
    </button>
  );
}
