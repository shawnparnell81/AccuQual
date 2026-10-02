import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { DocumentChangeRequest } from "../../api/types";
import { DataTable, type Column } from "../../components/tables/DataTable";

const dcrHooks = createResourceHooks<DocumentChangeRequest>("document-change-requests");

function requestAction(row: DocumentChangeRequest): string {
  const actions = [
    row.actionNew ? "New" : "",
    row.actionRevision ? "Revision" : "",
    row.actionCancellation ? "Cancellation/Obsolete" : "",
  ].filter(Boolean);
  return actions.join(", ");
}

/**
 * Document Change Request list. The record itself is paper form DCR-F-001.
 * Ungated, same as Document Control — any authenticated user can raise one.
 */
export function DocumentChangeRequestsPage() {
  const navigate = useNavigate();
  const { data: rows = [], isLoading, isError } = dcrHooks.useList();
  const createDcr = dcrHooks.useCreate();

  const columns: Column<DocumentChangeRequest>[] = [
    { header: "ID", accessor: (row) => `#${row.id}` },
    { header: "Document / Process", accessor: (row) => row.documentProcessName || "—" },
    { header: "Current Doc #", accessor: (row) => row.currentDocNumber || "—" },
    { header: "Requester", accessor: (row) => row.requesterName || "—" },
    { header: "Request Action", accessor: (row) => requestAction(row) || "—" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Document Change Requests</h1>
          <p className="text-sm text-muted-foreground">DCR-F-001. A request to add, revise, or cancel a controlled document.</p>
        </div>
        <button
          onClick={() => createDcr.mutate({} as never, { onSuccess: (created) => navigate(`/document-change-requests/${created.id}`) })}
          disabled={createDcr.isPending}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {createDcr.isPending ? "Creating…" : "+ New Document Change Request"}
        </button>
      </div>

      <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} isLoading={isLoading} isError={isError} onRowClick={(row) => navigate(`/document-change-requests/${row.id}`)} />
    </div>
  );
}
