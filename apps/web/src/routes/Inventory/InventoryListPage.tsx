import { useNavigate, Link } from "react-router-dom";
import { ResourceListPage } from "../../components/layout/ResourceListPage";
import { StatusBadge } from "../../components/tables/StatusBadge";
import type { InventoryItem } from "../../api/types";
import { ImportButton } from "../../components/import/ImportDialog";

/** Item roster + quick-create. Stock/movements/alerts live on InventoryDetailPage and InventoryAlertsPage; company-wide lot/serial search lives on InventoryLotsPage — same "reached from a link, not its own nav entry" convention InventoryAlertsPage already established. */
export function InventoryListPage() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Link to="/inventory/lots" className="text-xs text-primary hover:underline">
          Lot / Serial Search →
        </Link>
      </div>
      <ResourceListPage<InventoryItem>
        title="Inventory"
        headerActions={<ImportButton entity="inventory_items" />}
        resource="inventory/items"
        onRowClick={(i) => navigate(`/inventory/${i.id}`)}
        onCreated={(i) => navigate(`/inventory/${i.id}`)}
        columns={[
          { header: "SKU", accessor: (i) => i.sku },
          { header: "Description", accessor: (i) => i.description ?? "—" },
          { header: "Type", accessor: (i) => i.itemType.replace(/_/g, " ") },
          { header: "On Hand", accessor: (i) => i.onHand ?? 0 },
          { header: "Min / Max", accessor: (i) => `${i.minLevel} / ${i.maxLevel ?? "—"}` },
          { header: "State", accessor: (i) => <StatusBadge value={i.state} /> },
        ]}
        createFields={[
          { name: "sku", label: "SKU" },
          { name: "description", label: "Description" },
          { name: "itemType", label: "Item Type", type: "select", options: ["raw_material", "wip", "finished_good"] },
          { name: "unitOfMeasure", label: "Unit of Measure" },
          { name: "minLevel", label: "Min Level", type: "number" },
          { name: "maxLevel", label: "Max Level", type: "number" },
          { name: "unitCost", label: "Unit Cost", type: "number" },
        ]}
      />
    </div>
  );
}
