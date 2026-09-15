import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { DocumentChangeRequest, DocumentChangeStatus } from "../../api/types";
import { DataTable, type Column } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";

const dcrHooks = createResourceHooks<DocumentChangeRequest>("document-change-requests");

const STATUSES: DocumentChangeStatus[] = ["draft", "active", "obsolete"];

/**
 * Document Change Request list — a real QMS-document revision-control
 * register (see documentChangeRequests.ts's schema comment). Deliberately
 * ungated, same as Document Control itself — any authenticated user can
 * raise one.
 */
export function DocumentChangeRequestsPage() {
  const navigate = useNavigate();
  const { data: rows = [], isLoading } = dcrHooks.useList();
  const createDcr = dcrHooks.useCreate();
  const [statusFilter, setStatusFilter] = useState("");

  const filtered = useMemo(() => rows.filter((r) => !statusFilter || r.status === statusFilter), [rows, statusFilter]);

  const columns: Column<DocumentChangeRequest>[] = [
    { header: "ID", accessor: (r) => `#${r.id}` },
    { header: "Form No.", accessor: (r) => r.formNo ?? "—" },
    { header: "Revision", accessor: (r) => r.revision ?? "—" },
    { header: "Prepared By", accessor: (r) => r.preparedBy ?? "—" },
    { header: "Approved By", accessor: (r) => r.approvedBy ?? "—" },
    { header: "Status", accessor: (r) => <StatusBadge value={r.status} /> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Document Change Requests</h1>
          <p className="text-sm text-muted-foreground">Controls proposed changes to QMS documents.</p>
        </div>
        <button
          onClick={() => createDcr.mutate({} as never, { onSuccess: (created) => navigate(`/document-change-requests/${created.id}`) })}
          disabled={createDcr.isPending}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {createDcr.isPending ? "Creating…" : "+ New Document Change Request"}
        </button>
      </div>

      <div className="flex gap-3">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-border px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <DataTable columns={columns} rows={filtered} rowKey={(r) => r.id} isLoading={isLoading} onRowClick={(r) => navigate(`/document-change-requests/${r.id}`)} />
    </div>
  );
}
