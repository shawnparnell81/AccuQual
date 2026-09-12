import { useNavigate } from "react-router-dom";
import { ResourceListPage } from "../../components/layout/ResourceListPage";
import { StatusBadge } from "../../components/tables/StatusBadge";
import type { Audit } from "../../api/types";

export function AuditsPage() {
  const navigate = useNavigate();
  return (
    <ResourceListPage<Audit>
      title="Audits"
      resource="audits"
      onRowClick={(a) => navigate(`/audits/${a.id}`)}
      onCreated={(a) => navigate(`/audits/${a.id}`)}
      columns={[
        { header: "ID", accessor: (a) => `#${a.id}` },
        { header: "Name", accessor: (a) => a.name },
        { header: "Type", accessor: (a) => a.type ?? "—" },
        { header: "Status", accessor: (a) => <StatusBadge value={a.status} /> },
        { header: "Scheduled", accessor: (a) => (a.scheduledAt ? new Date(a.scheduledAt).toLocaleDateString() : "—") },
      ]}
      createFields={[
        { name: "name", label: "Audit name" },
        { name: "type", label: "Type", type: "select", options: ["internal", "supplier", "customer", "certification"] },
        { name: "scheduledAt", label: "Scheduled date", type: "date" },
      ]}
    />
  );
}
