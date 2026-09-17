import { apiClient } from "../../api/client";
import { useToast } from "./ToastProvider";
import { extractErrorMessageAsync } from "../../hooks/useWorkflowAction";

const FORMATS = [
  { format: "csv", label: "CSV", ext: "csv" },
  { format: "excel", label: "Excel", ext: "xlsx" },
  { format: "pdf", label: "PDF", ext: "pdf" },
] as const;

/** Phase 6 "Add Export Options" — one shared control for every report card; each click hits GET /reporting/export/:reportKey?format=... (RBAC-gated the same as the report's own metrics endpoint) and downloads the real file, same blob-download convention as AttachmentsPanel/DocumentHistoryPanel. */
export function ReportExportButtons({ reportKey, from, to }: { reportKey: string; from?: string; to?: string }) {
  const toast = useToast();

  async function exportAs(format: (typeof FORMATS)[number]["format"], ext: string) {
    try {
      const res = await apiClient.get(`/reporting/export/${reportKey}`, { params: { format, from, to }, responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${reportKey}-${new Date().toISOString().slice(0, 10)}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(await extractErrorMessageAsync(err, "Couldn't export this report."));
    }
  }

  return (
    <div className="flex gap-1.5">
      {FORMATS.map((f) => (
        <button
          key={f.format}
          onClick={() => exportAs(f.format, f.ext)}
          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
