import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/shared/ToastProvider";
import { useSiteStore } from "../../store/siteStore";
import type { LaborClaim } from "./laborClaim";
import { LaborClaimsList } from "./LaborClaimsList";

function claim(id: number, claimNumber: string, siteId: number | null): LaborClaim {
  return {
    id,
    claimNumber,
    status: "open",
    claimDate: "2026-08-01T00:00:00.000Z",
    customerName: "Greer",
    partName: "Pump",
    laborHours: "2",
    laborRate: "40",
    totalLaborCost: "80.00",
    warrantyClaimId: null,
    ncrId: null,
    notes: null,
    siteId,
    createdByUserId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: null,
  };
}

function renderList(rows: LaborClaim[]): string {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData(["labor-claims", {}], rows);
  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/labor-claims"]}>
        <ToastProvider>
          <LaborClaimsList />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LaborClaimsList", () => {
  it("renders an empty list, a populated list, and a plant change without looping", () => {
    useSiteStore.setState({ currentSiteId: null, siteScope: "all" });
    const empty = renderList([]);
    assert.match(empty, /Labor Claims/);
    assert.match(empty, /No labor claims match these filters/);
    assert.doesNotMatch(empty, /LC-PLANT-1/);

    const rows = [claim(1, "LC-PLANT-1", 1), claim(2, "LC-PLANT-2", 2), claim(3, "LC-UNASSIGNED", null)];
    const all = renderList(rows);
    assert.match(all, /LC-PLANT-1/);
    assert.match(all, /LC-PLANT-2/);
    assert.match(all, /LC-UNASSIGNED/);

    useSiteStore.setState({ currentSiteId: 2, siteScope: null });
    const plant = renderList(rows);
    assert.doesNotMatch(plant, /LC-PLANT-1/);
    assert.match(plant, /LC-PLANT-2/);
    assert.match(plant, /LC-UNASSIGNED/);

    useSiteStore.setState({ currentSiteId: 1, siteScope: null });
    const other = renderList(rows);
    assert.match(other, /LC-PLANT-1/);
    assert.doesNotMatch(other, /LC-PLANT-2/);

    useSiteStore.setState({ currentSiteId: null, siteScope: null });
  });
});
