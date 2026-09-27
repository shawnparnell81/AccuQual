import { useNavigate } from "react-router-dom";
import { ResourceListPage } from "../../components/layout/ResourceListPage";
import { StatusBadge } from "../../components/tables/StatusBadge";
import type { Supplier } from "../../api/types";
import { ImportButton } from "../../components/import/ImportDialog";

/** Internal supplier roster. Scorecards and risk stay on each supplier's own page. */
export function SuppliersPage() {
  const navigate = useNavigate();
  return (
    <ResourceListPage<Supplier>
      title="Suppliers"
      headerActions={<ImportButton entity="suppliers" />}
      resource="suppliers"
      onRowClick={(s) => navigate(`/suppliers/${s.id}`)}
      onCreated={(s) => navigate(`/suppliers/${s.id}`)}
      searchable={(s) => `${s.name} ${s.status ?? ""} ${s.riskLevel ?? ""}`}
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
