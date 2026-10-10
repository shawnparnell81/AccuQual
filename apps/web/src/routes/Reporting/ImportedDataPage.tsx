import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { AuditFacts } from "../../components/shared/AuditFacts";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useSiteStore } from "../../store/siteStore";
import { formatDateTime } from "../../lib/dates";

export interface ImportedRow {
  id: number;
  name: string;
  type: string;
  rowCount: number;
  sourceFileName: string;
  siteId: number | null;
  siteName: string | null;
  importedBy: string | null;
  importedAt: string | null;
  deletedAt: string | null;
  deleteReason: string | null;
}

interface ImportedList {
  available: boolean;
  rows: ImportedRow[];
}

interface ImportedDetail extends ImportedRow {
  headers: string[];
  rows: { row_number: number; cells: string[]; mapped: Record<string, string> }[];
  audit: { id: number; action: string; changes?: Record<string, unknown> | null; createdAt: string | null; performedByName: string | null }[];
}

export function importsForPlant(rows: readonly ImportedRow[], siteId: number | null, siteScope: "all" | null): ImportedRow[] {
  const visible = siteScope === "all" || siteId == null ? [...rows] : rows.filter((row) => row.siteId == null || row.siteId === siteId);
  return visible.sort((a, b) => String(b.importedAt ?? "").localeCompare(String(a.importedAt ?? "")));
}

async function downloadOriginal(id: number, fileName: string) {
  const res = await apiClient.get(`/reporting/imported-data/${id}/file`, { responseType: "blob" });
  const url = URL.createObjectURL(res.data as Blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function ImportedDataPage() {
  useSiteStore((s) => s.siteScope);
  useSiteStore((s) => s.currentSiteId);
  const { currentSiteId, siteScope } = useSiteStore.getState();
  const plantKey = siteScope === "all" ? "all" : currentSiteId;
  const [showRemoved, setShowRemoved] = useState(false);
  const list = useQuery<ImportedList>({
    queryKey: ["imported-data", plantKey, showRemoved],
    queryFn: async () => (await apiClient.get("/reporting/imported-data", { params: showRemoved ? { deleted: "1" } : {} })).data,
  });
  const rows = useMemo(() => importsForPlant(list.data?.rows ?? [], currentSiteId, siteScope), [list.data, currentSiteId, siteScope, plantKey]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Imported Data</h1>
          <p className="text-sm text-muted-foreground">Reports / Imported Data. Newest import first. A chosen plant includes files that were not assigned to a plant.</p>
        </div>
        <Link to="/admin/import" className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
          Import a file
        </Link>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showRemoved} onChange={(event) => setShowRemoved(event.target.checked)} />
        Show removed imports
      </label>
      {list.isLoading ? (
        <LoadingPlaceholder />
      ) : list.data?.available === false ? (
        <p className="text-sm text-muted-foreground">Imported Data isn't available until the database update runs.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No imports for this plant yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-3">Date imported</th>
              <th className="pb-2 pr-3">Name</th>
              <th className="pb-2 pr-3">Type</th>
              <th className="pb-2 pr-3">Imported by</th>
              <th className="pb-2 pr-3">Rows</th>
              <th className="pb-2">Site</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="py-1.5 pr-3 text-muted-foreground">{row.importedAt ? formatDateTime(row.importedAt) : "—"}</td>
                <td className="py-1.5 pr-3">
                  <Link to={`/reporting/imported-data/${row.id}`} className="text-primary hover:underline">
                    {row.name}
                  </Link>
                  {row.deletedAt && <span className="ml-2 text-xs text-destructive">Removed</span>}
                </td>
                <td className="py-1.5 pr-3">{row.type}</td>
                <td className="py-1.5 pr-3">{row.importedBy ?? "—"}</td>
                <td className="py-1.5 pr-3">{row.rowCount.toLocaleString()}</td>
                <td className="py-1.5">{row.siteName ?? "Unassigned"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function ImportedDataDetailPage() {
  const params = useParams();
  const id = Number(params.id);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"delete" | "restore" | null>(null);
  const detail = useQuery<ImportedDetail>({
    queryKey: ["imported-data", id],
    queryFn: async () => (await apiClient.get(`/reporting/imported-data/${id}`)).data,
    enabled: Number.isInteger(id) && id > 0,
  });

  const act = useMutation({
    mutationFn: async () => {
      const path = mode === "restore" ? "restore" : "delete";
      return (await apiClient.post(`/reporting/imported-data/${id}/${path}`, { reason: reason.trim() })).data;
    },
    onSuccess: () => {
      toast.success(mode === "restore" ? "Import restored." : "Import removed.");
      setMode(null);
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["imported-data"] });
      void detail.refetch();
    },
    onError: (err) => toast.error(extractErrorMessage(err, "That change didn't save.")),
  });

  const file = detail.data;
  if (detail.isLoading) return <LoadingPlaceholder />;
  if (!file) return <p className="text-sm text-muted-foreground">That import isn't available.</p>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <button type="button" className="text-xs text-muted-foreground hover:text-primary" onClick={() => navigate("/reporting/imported-data")}>
          Imported Data
        </button>
        <h1 className="text-2xl font-semibold">{file.name}</h1>
        <p className="text-sm text-muted-foreground">
          {file.type} · {file.rowCount.toLocaleString()} rows · {file.sourceFileName} · {file.siteName ?? "Unassigned"}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {!file.deletedAt && (
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm"
            onClick={() => void downloadOriginal(file.id, file.sourceFileName).catch((err) => toast.error(extractErrorMessage(err, "Couldn't download that file.")))}
          >
            Download original
          </button>
        )}
        <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => setMode(file.deletedAt ? "restore" : "delete")}>
          {file.deletedAt ? "Restore" : "Remove"}
        </button>
      </div>
      {mode && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <label className="text-sm">
            {mode === "restore" ? "Why is this being restored?" : "Why is this being removed?"}
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm" rows={3} />
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={act.isPending || !reason.trim()} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60" onClick={() => act.mutate()}>
              {mode === "restore" ? "Restore" : "Remove"}
            </button>
            <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              {(file.headers ?? []).slice(0, 8).map((header) => (
                <th key={header} className="pb-1 pr-3">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {file.rows.map((row) => (
              <tr key={row.row_number} className="border-t border-border">
                {(row.cells ?? []).slice(0, 8).map((cell, index) => (
                  <td key={index} className="max-w-[12rem] truncate py-1 pr-3">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Audit trail</h2>
        {file.audit.length === 0 && <p className="text-sm text-muted-foreground">No audit entries yet.</p>}
        {file.audit.map((entry) => (
          <AuditFacts key={entry.id} entry={entry} when={entry.createdAt ? formatDateTime(entry.createdAt) : "—"} whenIso={entry.createdAt ?? undefined} record={file.name} />
        ))}
      </div>
    </div>
  );
}
