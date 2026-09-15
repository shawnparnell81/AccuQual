import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { QualityInspectionReport } from "../../api/types";
import { DataTable, type Column } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";

const reportHooks = createResourceHooks<QualityInspectionReport>("quality-inspection-reports");

export function QualityInspectionReportsPage() {
  const navigate = useNavigate();
  const { data: rows = [], isLoading } = reportHooks.useList();
  const createReport = reportHooks.useCreate();

  const columns: Column<QualityInspectionReport>[] = [
    { header: "ID", accessor: (r) => `#${r.id}` },
    { header: "Type", accessor: (r) => r.inspectionType?.replace(/_/g, " ") ?? "—" },
    { header: "Part / Material #", accessor: (r) => r.partMaterialNo ?? "—" },
    { header: "Supplier / Vendor", accessor: (r) => r.supplierVendor ?? "—" },
    { header: "Inspector", accessor: (r) => r.inspectorName ?? "—" },
    { header: "Final Status", accessor: (r) => (r.finalStatus ? <StatusBadge value={r.finalStatus} /> : "—") },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Quality Inspection Reports</h1>
          <p className="text-sm text-muted-foreground">Receiving / In-Process / Final inspection checklist and disposition.</p>
        </div>
        <button
          onClick={() => createReport.mutate({} as never, { onSuccess: (created) => navigate(`/quality-inspection-reports/${created.id}`) })}
          disabled={createReport.isPending}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {createReport.isPending ? "Creating…" : "+ New Report"}
        </button>
      </div>

      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} isLoading={isLoading} onRowClick={(r) => navigate(`/quality-inspection-reports/${r.id}`)} />
    </div>
  );
}
