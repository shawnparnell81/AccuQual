import { Link, useNavigate } from "react-router-dom";
import { useFaiSources } from "../../api/fai";
import { DataTable, type Column } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { formalDate } from "../../lib/faiLogic";

const STATUS_LABEL: Record<string, string> = { pending: "Pending", approved: "Approved", failed: "Not approved" };

export function FaiSourcesPage() {
  const navigate = useNavigate();
  const sources = useFaiSources();
  const columns: Column<NonNullable<typeof sources.data>[number]>[] = [
    { header: "Part", accessor: (row) => row.partNumber },
    { header: "Supplier", accessor: (row) => row.supplierName },
    { header: "Status", accessor: (row) => <StatusBadge value={row.status} /> },
    { header: "Meaning", accessor: (row) => STATUS_LABEL[row.status] ?? row.status },
    { header: "Last pass", accessor: (row) => (row.lastPassDate ? formalDate(row.lastPassDate) : "—") },
    { header: "Next due", accessor: (row) => (row.nextDueDate ? formalDate(row.nextDueDate) : "—") },
    { header: "Cadence", accessor: (row) => `${row.cadenceMonths} months` },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link to="/fai" className="text-xs text-primary hover:underline">First Article</Link>
        <h1 className="text-2xl font-semibold">Source approval</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          One row for each part and supplier. A new supplier starts pending. Approval sets the last pass date and the next due date. A rejection marks the source not approved. Nothing here blocks receipts, inventory, or purchase orders.
        </p>
      </div>
      <DataTable
        columns={columns}
        rows={sources.data ?? []}
        rowKey={(row) => row.id}
        isLoading={sources.isLoading}
        isError={sources.isError}
        emptyMessage="No part and supplier has a source row yet. Open a first article to create one."
        onRowClick={(row) => row.lastFaiId && navigate(`/fai/records/${row.lastFaiId}`)}
      />
    </div>
  );
}
