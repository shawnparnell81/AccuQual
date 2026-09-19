import { useNavigate } from "react-router-dom";
import { ResourceListPage } from "../../components/layout/ResourceListPage";
import { StatusBadge } from "../../components/tables/StatusBadge";

interface Complaint {
  id: number;
  customerName: string | null;
  description: string;
  severity: string | null;
  status: string;
}

export function ComplaintsPage() {
  const navigate = useNavigate();
  return (
    <ResourceListPage<Complaint>
      title="Customer Complaints"
      resource="complaints"
      onRowClick={(c) => navigate(`/complaints/${c.id}`)}
      onCreated={(c) => navigate(`/complaints/${c.id}`)}
      columns={[
        { header: "ID", accessor: (c) => `#${c.id}` },
        { header: "Customer", accessor: (c) => c.customerName ?? "—" },
        { header: "Description", accessor: (c) => c.description },
        { header: "Severity", accessor: (c) => <StatusBadge value={c.severity} /> },
        { header: "Status", accessor: (c) => <StatusBadge value={c.status} /> },
      ]}
      createFields={[
        { name: "customerName", label: "Customer name" },
        { name: "productAffected", label: "Product affected" },
        { name: "description", label: "Description" },
        { name: "severity", label: "Severity", type: "select", options: ["low", "medium", "high", "critical"] },
      ]}
    />
  );
}
