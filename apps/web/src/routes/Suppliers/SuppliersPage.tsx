import { useNavigate } from "react-router-dom";
import { ResourceListPage } from "../../components/layout/ResourceListPage";
import { StatusBadge } from "../../components/tables/StatusBadge";
import type { Supplier } from "../../api/types";

/** Supplier scorecards summary lives on the Dashboard; this page manages the supplier roster. */
export function SuppliersPage() {
  const navigate = useNavigate();
  return (
    <ResourceListPage<Supplier>
      title="Suppliers"
      resource="suppliers"
      onRowClick={(s) => navigate(`/suppliers/${s.id}`)}
      onCreated={(s) => navigate(`/suppliers/${s.id}`)}
      columns={[
        { header: "ID", accessor: (s) => `#${s.id}` },
        { header: "Name", accessor: (s) => s.name },
        { header: "Status", accessor: (s) => <StatusBadge value={s.status} /> },
        { header: "Risk Level", accessor: (s) => <StatusBadge value={s.riskLevel} /> },
      ]}
      createFields={[
        { name: "name", label: "Supplier name" },
        { name: "contactEmail", label: "Contact email" },
      ]}
    />
  );
}
