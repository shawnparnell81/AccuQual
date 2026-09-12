import { useNavigate } from "react-router-dom";
import { ResourceListPage } from "../../components/layout/ResourceListPage";
import { StatusBadge } from "../../components/tables/StatusBadge";

export interface PpapPackage {
  id: number;
  partNumber: string;
  partName: string | null;
  customer: string | null;
  status: string;
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
        { header: "ID", accessor: (p) => `#${p.id}` },
        { header: "Part Number", accessor: (p) => p.partNumber },
        { header: "Part Name", accessor: (p) => p.partName ?? "—" },
        { header: "Customer", accessor: (p) => p.customer ?? "—" },
        { header: "Status", accessor: (p) => <StatusBadge value={p.status} /> },
      ]}
      createFields={[
        { name: "partNumber", label: "Part number" },
        { name: "partName", label: "Part name" },
        { name: "customer", label: "Customer" },
      ]}
    />
  );
}
