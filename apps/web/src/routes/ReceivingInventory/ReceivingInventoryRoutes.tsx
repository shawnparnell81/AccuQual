import { Route, Routes } from "react-router-dom";
import { NotFoundPage } from "../NotFoundPage";
import { InventoryListPage } from "../Inventory/InventoryListPage";
import { InventoryAlertsPage } from "../Inventory/InventoryAlertsPage";
import { InventoryLotsPage } from "../Inventory/InventoryLotsPage";
import { InventoryLotDetailPage } from "../Inventory/InventoryLotDetailPage";
import { InventoryDetailPage } from "../Inventory/InventoryDetailPage";
import { ErpPurchaseOrdersPage } from "../Erp/ErpPurchaseOrdersPage";
import { ErpNewPurchaseOrderPage } from "../Erp/ErpNewPurchaseOrderPage";
import { ErpPurchaseOrderDetailPage } from "../Erp/ErpPurchaseOrderDetailPage";
import { ErpRequisitionsPage } from "../Erp/ErpRequisitionsPage";
import { ErpRequisitionDetailPage } from "../Erp/ErpRequisitionDetailPage";

/** /inventory/* (the gate is in workspaceRoutes): item list, alerts, lots, lot detail, item detail. */
export function InventoryRoutes() {
  return (
    <Routes>
      <Route index element={<InventoryListPage />} />
      <Route path="alerts" element={<InventoryAlertsPage />} />
      <Route path="lots" element={<InventoryLotsPage />} />
      <Route path="lots/:id" element={<InventoryLotDetailPage />} />
      <Route path=":id" element={<InventoryDetailPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

/** /erp/*: purchase orders (receiving happens on the order) and requisitions. */
export function ErpRoutes() {
  return (
    <Routes>
      <Route index element={<ErpPurchaseOrdersPage />} />
      <Route path="new" element={<ErpNewPurchaseOrderPage />} />
      <Route path="requisitions" element={<ErpRequisitionsPage />} />
      <Route path="requisitions/:id" element={<ErpRequisitionDetailPage />} />
      <Route path=":id" element={<ErpPurchaseOrderDetailPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
