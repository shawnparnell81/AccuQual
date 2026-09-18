import { useNavigate } from "react-router-dom";
import { ResourceListPage } from "../../components/layout/ResourceListPage";
import { StatusBadge } from "../../components/tables/StatusBadge";
import type { Supplier } from "../../api/types";

/**
 * A scorecards summary lives on the Dashboard; this page manages the
 * supplier roster. Full-System Audit finding L1: added a real
 * "View Scorecard" entry point per row (deep-links into the existing
 * Supplier Portal scorecard tab) — previously the only way there was
 * navigating to /supplier-portal and picking the supplier by hand.
 */
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
        {
          // Full-System Audit finding L1 — the scorecard existed
          // (Supplier Portal's own "Scorecard" tab, see SupplierScorecard.tsx)
          // but nothing on the roster pointed at it; internal staff had to
          // already know to go to /supplier-portal and pick the supplier by
          // hand. Deep-links into the SAME existing path/component via the
          // ?supplierId=&tab=scorecard params SupplierPortalHome.tsx now reads.
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
        { name: "contactEmail", label: "Contact email" },
      ]}
    />
  );
}
