import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { DataTable } from "../../components/tables/DataTable";
import type { ErpPurchaseOrder } from "../../api/types";

const poHooks = createResourceHooks<ErpPurchaseOrder>("erp/purchase-orders");

/** Purchase Order roster. Creation needs a dynamic line-item builder the generic quick-create modal can't do, so it's its own page (ErpNewPurchaseOrderPage), not a modal. */
export function ErpPurchaseOrdersPage() {
  const navigate = useNavigate();
  const { data: purchaseOrders = [], isLoading } = poHooks.useList();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Purchase Orders</h1>
        <button onClick={() => navigate("/erp/new")} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
          + New Purchase Order
        </button>
      </div>

      <DataTable<ErpPurchaseOrder>
        columns={[
          { header: "ID", accessor: (po) => `#${po.id}` },
          { header: "Supplier", accessor: (po) => po.supplierName ?? "—" },
          { header: "Status", accessor: (po) => <StatusBadge value={po.status} /> },
          { header: "Created", accessor: (po) => new Date(po.createdAt).toLocaleDateString() },
          { header: "Notes", accessor: (po) => po.notes ?? "—" },
        ]}
        rows={purchaseOrders}
        rowKey={(po) => po.id}
        isLoading={isLoading}
        onRowClick={(po) => navigate(`/erp/${po.id}`)}
        emptyMessage="No purchase orders yet."
      />
    </div>
  );
}
