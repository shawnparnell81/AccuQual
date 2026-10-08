import { useNavigate } from "react-router-dom";
import { ResourceListPage } from "../../components/layout/ResourceListPage";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { showRecordNumber } from "../../lib/userRecordNumber";

export interface PpapPackage {
  id: number;
  recordNumber?: string | null;
  partNumber: string;
  partName: string | null;
  customer: string | null;
  status: string;
  ownerId?: number | null;
}

export function PpapListPage() {
  const navigate = useNavigate();
  return (
    <ResourceListPage<PpapPackage>
      title="PPAP / APQP"
      resource="ppap"
      onRowClick={(p) => navigate(`/ppap/${p.id}`)}
      onCreated={(p) => navigate(`/ppap/${p.id}`)}
      columns={[
        { header: "PPAP No.", accessor: (p) => showRecordNumber(p.recordNumber) },
        { header: "Part Number", accessor: (p) => p.partNumber },
        { header: "Part Name", accessor: (p) => p.partName ?? "—" },
        { header: "Customer", accessor: (p) => p.customer ?? "—" },
        { header: "Status", accessor: (p) => <StatusBadge value={p.status} /> },
      ]}
      createFields={[
        { name: "recordNumber", label: "PPAP No." },
        { name: "partNumber", label: "Part number" },
        { name: "partName", label: "Part name" },
        { name: "customer", label: "Customer" },
      ]}
    />
  );
}
