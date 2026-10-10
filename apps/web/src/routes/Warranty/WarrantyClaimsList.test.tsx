import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/shared/ToastProvider";
import { useSiteStore } from "../../store/siteStore";
import type { WarrantyClaim } from "../../api/types";
import { WarrantyClaimsList } from "./WarrantyClaimsList";

function claim(id: number, claimNumber: string, siteId: number | null): WarrantyClaim {
  return {
    id,
    claimNumber,
    status: "new",
    customerId: null,
    productId: null,
    serialNumber: null,
    purchaseDate: null,
    failureDate: null,
    failureDescription: null,
    failureImages: [],
    documents: [],
    warrantyCostEstimate: null,
    warrantyActualCost: null,
    supplierId: null,
    linkedNcrId: null,
    linkedWorkOrderId: null,
    inspectionNotes: null,
    inspectedByUserId: null,
    inspectionDate: null,
    supplierReviewNotes: null,
    dispositionNotes: null,
    createdByUserId: null,
    siteId,
    createdAt: "2026-01-15T00:00:00.000Z",
    updatedAt: null,
  };
}

function renderList(rows: WarrantyClaim[]): string {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData(["warranty/claims", {}], rows);
  queryClient.setQueryData(["inventory/items", undefined], []);
  queryClient.setQueryData(["suppliers", undefined], []);
  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/warranty"]}>
        <ToastProvider>
          <WarrantyClaimsList />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("WarrantyClaimsList", () => {
  it("renders an empty list, a populated list, and a plant change without looping", () => {
    useSiteStore.setState({ currentSiteId: null, siteScope: "all" });
    const empty = renderList([]);
    assert.match(empty, /Warranty Claims/);
    assert.match(empty, /No warranty claims match these filters/);
    assert.doesNotMatch(empty, /WC-PLANT-1/);

    const rows = [claim(1, "WC-PLANT-1", 1), claim(2, "WC-PLANT-2", 2), claim(3, "WC-UNASSIGNED", null)];
    const all = renderList(rows);
    assert.match(all, /WC-PLANT-1/);
    assert.match(all, /WC-PLANT-2/);
    assert.match(all, /WC-UNASSIGNED/);

    useSiteStore.setState({ currentSiteId: 2, siteScope: null });
    const plant = renderList(rows);
    assert.doesNotMatch(plant, /WC-PLANT-1/);
    assert.match(plant, /WC-PLANT-2/);
    assert.match(plant, /WC-UNASSIGNED/);

    useSiteStore.setState({ currentSiteId: 1, siteScope: null });
    const other = renderList(rows);
    assert.match(other, /WC-PLANT-1/);
    assert.doesNotMatch(other, /WC-PLANT-2/);

    useSiteStore.setState({ currentSiteId: null, siteScope: null });
  });
});
