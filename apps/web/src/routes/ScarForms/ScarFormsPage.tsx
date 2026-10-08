import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { ScarForm } from "../../api/types";
import { NumberedCreateButton } from "../../components/forms/RecordNumberField";
import { DataTable, type Column } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";

const scarHooks = createResourceHooks<ScarForm>("scar-forms");

export function ScarFormsPage() {
  const navigate = useNavigate();
  const { data: rows = [], isLoading, isError } = scarHooks.useList();
  const createScar = scarHooks.useCreate();

  const columns: Column<ScarForm>[] = [
    { header: "SCAR No.", accessor: (r) => r.scarNumber?.trim() || "" },
    { header: "Supplier", accessor: (r) => r.supplierName ?? "—" },
    { header: "PO Number", accessor: (r) => r.poNumber ?? "—" },
    { header: "Status", accessor: (r) => <StatusBadge value={r.status} /> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Supplier Corrective Action Requests</h1>
          <p className="text-sm text-muted-foreground">Communicates a supplier nonconformity, its root cause, and its corrective/preventive action plan.</p>
        </div>
        <NumberedCreateButton
          label="+ New SCAR"
          numberLabel="SCAR No."
          dialogTitle="New SCAR"
          pending={createScar.isPending}
          onCreate={async (recordNumber) => {
            const created = await createScar.mutateAsync({ scarNumber: recordNumber.trim() || null } as never);
            navigate(`/scar-forms/${created.id}`);
          }}
        />
      </div>

      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} isLoading={isLoading} isError={isError} onRowClick={(r) => navigate(`/scar-forms/${r.id}`)} />
    </div>
  );
}
