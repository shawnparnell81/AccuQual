import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { faiInspectionApi, FAI_REPORT_KEYS, type FaiReportFilters } from "../../api/faiInspection";
import { useSites } from "../../hooks/useSites";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

export function FaiReportsPage() {
  const { data: sites } = useSites();
  const [reportKey, setReportKey] = useState<string>(FAI_REPORT_KEYS[0].key);
  const [filters, setFilters] = useState<FaiReportFilters>({});
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const { data: preview, isLoading, error } = useQuery({
    queryKey: ["fai-reports", "preview", reportKey, filters],
    queryFn: () => faiInspectionApi.reports.preview(reportKey, filters),
  });

  async function download(format: "pdf" | "excel") {
    setDownloading(true);
    setDownloadError(null);
    try {
      await faiInspectionApi.reports.download(reportKey, format, filters);
    } catch (err) {
      setDownloadError(extractErrorMessage(err, "Could not download the report."));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">FAI Reports</h1>

      <div className="flex flex-wrap gap-3 mb-4">
        <select value={reportKey} onChange={(e) => setReportKey(e.target.value)} className="border rounded px-3 py-2">
          {FAI_REPORT_KEYS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <input type="date" value={filters.from ?? ""} onChange={(e) => setFilters({ ...filters, from: e.target.value || undefined })} className="border rounded px-3 py-2" title="From" />
        <input type="date" value={filters.to ?? ""} onChange={(e) => setFilters({ ...filters, to: e.target.value || undefined })} className="border rounded px-3 py-2" title="To" />
        <select value={filters.siteId ?? ""} onChange={(e) => setFilters({ ...filters, siteId: e.target.value ? Number(e.target.value) : undefined })} className="border rounded px-3 py-2">
          <option value="">All plants</option>
          {(sites?.sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input placeholder="Part number" value={filters.partNumber ?? ""} onChange={(e) => setFilters({ ...filters, partNumber: e.target.value || undefined })} className="border rounded px-3 py-2" />
        <input placeholder="Product family" value={filters.productFamily ?? ""} onChange={(e) => setFilters({ ...filters, productFamily: e.target.value || undefined })} className="border rounded px-3 py-2" />
      </div>

      <div className="flex gap-3 mb-4">
        <button onClick={() => download("pdf")} disabled={downloading} className="rounded bg-primary text-primary-foreground px-4 py-2 disabled:opacity-50">Download PDF</button>
        <button onClick={() => download("excel")} disabled={downloading} className="rounded border px-4 py-2 disabled:opacity-50">Download Excel</button>
        {downloadError && <span className="text-sm text-red-600 self-center">{downloadError}</span>}
      </div>

      {isLoading ? <div>Loading…</div> : error ? (
        <div className="bg-red-50 text-red-700 p-3 rounded">{extractErrorMessage(error, "Could not load this report.")}</div>
      ) : preview && preview.rows.length === 0 ? (
        <div className="text-gray-500">No records yet.</div>
      ) : preview ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                {preview.columns.map((c) => <th key={c} className="p-2">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row, i) => (
                <tr key={i} className="border-b">
                  {row.map((cell, j) => <td key={j} className="p-2">{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
