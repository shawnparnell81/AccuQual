import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { downloadXlsx } from "../../lib/downloadTable";
import "../IsoForms/isoForm.css";

interface MasterDocumentRow {
  id: number;
  documentId: string;
  title: string;
  currentRev: string;
  approvalDate: string | null;
  approvedBy: string;
  location: string;
  status: string;
  revHistory: string;
}

export function MasterDocumentListPage() {
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const list = useQuery<MasterDocumentRow[]>({
    queryKey: ["documents", "master-list"],
    queryFn: async () => (await apiClient.get<MasterDocumentRow[]>("/documents/master-list")).data,
  });
  const rows = list.data ?? [];
  const latest = rows.map((row) => row.approvalDate).filter((value): value is string => !!value).sort().at(-1) ?? "";

  async function exportExcel() {
    setExporting(true);
    try {
      await downloadXlsx(
        "LST-GEN-001-master-document-list.xlsx",
        ["Document ID", "Document Title", "Current Rev", "Approval Date", "Approved By", "Location / Folder", "Status", "Rev History / Notes"],
        rows.map((row) => [row.documentId, row.title, row.currentRev, row.approvalDate ?? "", row.approvedBy, row.location, row.status, row.revHistory]),
      );
    } catch {
      toast.error("Couldn't export this list.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Master Document List</h1>
          <p className="text-sm text-muted-foreground">
            Document ID: LST-GEN-001 · Structure Rev: B{latest ? ` · Last Updated: ${latest}` : ""}. Rows come from document control: revisions, approvals, and folders.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/documents" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">Documents</Link>
          <button type="button" onClick={() => void exportExcel()} disabled={exporting} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60">
            {exporting ? "Exporting…" : "Export to Excel"}
          </button>
          <button type="button" onClick={() => window.print()} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Print
          </button>
        </div>
      </div>

      <div className="aq-print-sheet rounded-lg border border-border bg-card p-4">
        {list.isLoading && <p className="text-sm text-muted-foreground">Loading documents…</p>}
        {list.isError && <p className="text-sm text-destructive">Couldn't load the document register.</p>}
        <div className="iso-wrap">
          <table className="iso" data-testid="master-document-list" aria-label="Master Document List">
            <thead>
              <tr>
                {["Document ID", "Document Title", "Current Rev", "Approval Date", "Approved By", "Location / Folder", "Status", "Rev History / Notes"].map((heading) => (
                  <th key={heading} className="header">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.documentId}</td>
                  <td className="left">
                    <Link to={`/documents/${row.id}`} className="text-primary hover:underline">{row.title}</Link>
                  </td>
                  <td>{row.currentRev}</td>
                  <td>{row.approvalDate ?? ""}</td>
                  <td>{row.approvedBy}</td>
                  <td className="left">{row.location}</td>
                  <td>{row.status}</td>
                  <td className="left">{row.revHistory}</td>
                </tr>
              ))}
              {rows.length === 0 && !list.isLoading && (
                <tr>
                  <td colSpan={8} className="left">No controlled documents yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
