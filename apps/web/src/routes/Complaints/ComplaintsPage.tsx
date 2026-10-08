import { useNavigate } from "react-router-dom";
import { ResourceListPage } from "../../components/layout/ResourceListPage";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { showRecordNumber } from "../../lib/userRecordNumber";

interface Complaint {
  id: number;
  recordNumber?: string | null;
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
        { header: "Complaint No.", accessor: (c) => showRecordNumber(c.recordNumber) },
        { header: "Customer", accessor: (c) => c.customerName ?? "—" },
        { header: "Description", accessor: (c) => c.description },
        { header: "Severity", accessor: (c) => <StatusBadge value={c.severity} /> },
        { header: "Status", accessor: (c) => <StatusBadge value={c.status} /> },
      ]}
      createFields={[
        { name: "recordNumber", label: "Complaint No." },
        { name: "customerName", label: "Customer name" },
        { name: "productAffected", label: "Product affected" },
        { name: "description", label: "Description" },
        { name: "severity", label: "Severity", type: "select", options: ["low", "medium", "high", "critical"] },
      ]}
    />
  );
}
