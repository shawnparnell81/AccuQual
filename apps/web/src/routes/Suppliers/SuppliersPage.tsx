import { useNavigate } from "react-router-dom";
import { ResourceListPage } from "../../components/layout/ResourceListPage";
import { StatusBadge } from "../../components/tables/StatusBadge";
import type { Supplier } from "../../api/types";
import { ImportButton } from "../../components/import/ImportDialog";

/**
 * A scorecards summary lives on the Dashboard; this page manages the
 * supplier roster. "View Scorecard" deep-links into the Supplier Portal
 * scorecard tab for that supplier.
 */
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
        {
          header: "Scorecard",
          accessor: (s) => (
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/supplier-portal?supplierId=${s.id}&tab=scorecard`);
              }}
              className="text-sm font-medium text-primary hover:underline"
            >
              View Scorecard
            </button>
          ),
        },
      ]}
      createFields={[
        { name: "name", label: "Supplier name" },
        { name: "contactName", label: "Contact name" },
        { name: "contactEmail", label: "Contact email" },
        { name: "phone", label: "Phone" },
      ]}
    />
  );
}
