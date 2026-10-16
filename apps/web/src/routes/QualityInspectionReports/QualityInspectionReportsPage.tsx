import { useServerTable } from "../../api/usePagedList";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { QualityInspectionReport } from "../../api/types";
import { DataTable, type Column } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { NumberedCreateButton } from "../../components/forms/RecordNumberField";
import { showRecordNumber } from "../../lib/userRecordNumber";

const reportHooks = createResourceHooks<QualityInspectionReport>("quality-inspection-reports");

export function QualityInspectionReportsPage() {
  const navigate = useNavigate();
  const { rows: rows, isLoading, isError, server } = useServerTable<QualityInspectionReport>("/quality-inspection-reports", { root: "quality-inspection-reports", });
  const createReport = reportHooks.useCreate();

  const columns: Column<QualityInspectionReport>[] = [
    { header: "Report No.", sortKey: "recordNumber", accessor: (r) => showRecordNumber(r.recordNumber) },
    { header: "Type", sortKey: "inspectionType", accessor: (r) => r.inspectionType?.replace(/_/g, " ") ?? "—" },
    { header: "Part / Material #", sortKey: "partMaterialNo", accessor: (r) => r.partMaterialNo ?? "—" },
    { header: "Supplier / Vendor", sortKey: "supplierVendor", accessor: (r) => r.supplierVendor ?? "—" },
    { header: "Inspector", sortKey: "inspectorName", accessor: (r) => r.inspectorName ?? "—" },
    { header: "Final Status", sortKey: "finalStatus", accessor: (r) => (r.finalStatus ? <StatusBadge value={r.finalStatus} /> : "—") },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Quality Inspection Reports</h1>
          <p className="text-sm text-muted-foreground">Receiving / In-Process / Final inspection checklist and disposition.</p>
        </div>
        <NumberedCreateButton
          label="+ New Report"
          numberLabel="Report No."
          dialogTitle="New inspection report"
          pending={createReport.isPending}
          onCreate={async (recordNumber) => {
            const created = await createReport.mutateAsync({ recordNumber: recordNumber.trim() || null } as never);
            navigate(`/quality-inspection-reports/${created.id}`);
          }}
        />
      </div>

      <DataTable server={server} columns={columns} rows={rows} rowKey={(r) => r.id} isLoading={isLoading} isError={isError} onRowClick={(r) => navigate(`/quality-inspection-reports/${r.id}`)} />
    </div>
  );
}
