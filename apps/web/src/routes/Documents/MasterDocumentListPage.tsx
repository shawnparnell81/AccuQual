import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { RecordEditButton } from "../../components/shared/RecordEditButton";
import { useCanEditSurface, useRecordEdit } from "../../components/shared/RecordEditBar";
import { useToast } from "../../components/shared/ToastProvider";
import { downloadXlsx } from "../../lib/downloadTable";
import { recordSurface } from "../../lib/recordSurface";
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
  href?: string;
}

interface CellDraft {
  approvalDate: string;
  approvedBy: string;
}

export function MasterDocumentListPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { editing, setEditing } = useRecordEdit();
  const canEdit = useCanEditSurface(recordSurface("/documents/master-list"));
  const [exporting, setExporting] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, CellDraft>>({});
  const timers = useRef<Map<number, number>>(new Map());
  const list = useQuery<MasterDocumentRow[]>({
    queryKey: ["documents", "master-list"],
    queryFn: async () => (await apiClient.get<MasterDocumentRow[]>("/documents/master-list")).data,
  });
  const rows = list.data ?? [];
  const latest = rows.map((row) => row.approvalDate).filter((value): value is string => !!value).sort().at(-1) ?? "";
  const inline = canEdit && editing;

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      let changed = false;
      for (const row of rows) {
        const draft = next[row.id];
        if (!draft) continue;
        if (draft.approvalDate === (row.approvalDate ?? "") && draft.approvedBy === row.approvedBy) {
          delete next[row.id];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [rows]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
    };
  }, []);

  function shown(row: MasterDocumentRow): CellDraft {
    return drafts[row.id] ?? { approvalDate: row.approvalDate ?? "", approvedBy: row.approvedBy };
  }

  function queueSave(row: MasterDocumentRow, next: CellDraft) {
    const existing = timers.current.get(row.id);
    if (existing) window.clearTimeout(existing);
    timers.current.set(
      row.id,
      window.setTimeout(() => {
        const body: { id: number; approvalDate?: string; approvedBy?: string } = { id: row.id };
        if (next.approvalDate !== (row.approvalDate ?? "")) body.approvalDate = next.approvalDate;
        if (next.approvedBy !== row.approvedBy) body.approvedBy = next.approvedBy;
        if (body.approvalDate === undefined && body.approvedBy === undefined) return;
        void apiClient
          .patch("/documents/master-list/rows", body)
          .then(() => queryClient.invalidateQueries({ queryKey: ["documents", "master-list"] }))
          .catch(() => toast.error("Couldn't save that row."));
      }, 400),
    );
  }

  function changeCell(row: MasterDocumentRow, key: keyof CellDraft, value: string) {
    const next = { ...shown(row), [key]: value };
    setDrafts((current) => ({ ...current, [row.id]: next }));
    queueSave(row, next);
  }

  async function exportExcel() {
    setExporting(true);
    try {
      await downloadXlsx(
        "LST-GEN-001-master-document-list.xlsx",
        ["Document ID", "Document Title", "Current Rev", "Approval Date", "Approved By", "Location / Folder", "Status", "Rev History / Notes"],
        rows.map((row) => {
          const cells = shown(row);
          return [row.documentId, row.title, row.currentRev, cells.approvalDate, cells.approvedBy, row.location, row.status, row.revHistory];
        }),
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
            Document ID: LST-GEN-001 · Structure Rev: B{latest ? ` · Last Updated: ${latest}` : ""}. Controlled documents and in-app forms. A form uses the document number stored on its template.
            {canEdit ? " Edit to fill Approval Date and Approved By. What you type is saved. Cells you leave untouched keep the value already on the record." : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && <RecordEditButton editing={editing} onClick={() => setEditing(!editing)} />}
          <Link to="/documents" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">Documents</Link>
          <Link to="/documents/import" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">Import</Link>
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
          <table className="iso" data-testid="master-document-list" data-paste-grid="" aria-label="Master Document List">
            <thead>
              <tr>
                {["Document ID", "Document Title", "Current Rev", "Approval Date", "Approved By", "Location / Folder", "Status", "Rev History / Notes"].map((heading) => (
                  <th key={heading} className="header">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const cells = shown(row);
                return (
                  <tr key={row.id}>
                    <td>{row.documentId}</td>
                    <td className="left">
                      <Link to={row.href || `/documents/${row.id}`} className="text-primary hover:underline">{row.title}</Link>
                    </td>
                    <td>{row.currentRev}</td>
                    <td>
                      {inline ? (
                        <input
                          className="iso-in"
                          aria-label={`Approval Date for ${row.documentId}`}
                          data-value-kind="date"
                          value={cells.approvalDate}
                          onChange={(event) => changeCell(row, "approvalDate", event.target.value)}
                        />
                      ) : (
                        cells.approvalDate
                      )}
                    </td>
                    <td>
                      {inline ? (
                        <input
                          className="iso-in"
                          aria-label={`Approved By for ${row.documentId}`}
                          value={cells.approvedBy}
                          onChange={(event) => changeCell(row, "approvedBy", event.target.value)}
                        />
                      ) : (
                        cells.approvedBy
                      )}
                    </td>
                    <td className="left">{row.location}</td>
                    <td>{row.status}</td>
                    <td className="left">{row.revHistory}</td>
                  </tr>
                );
              })}
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
