import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { FaiRecordDetailPage } from "./FaiRecordDetailPage";
import type { FaiRecord } from "../../api/faiInspection";

function baseRecord(overrides: Partial<FaiRecord> = {}): FaiRecord {
  return {
    id: 123,
    faiNumber: "FAI-TEST-001",
    partNumber: "PART-001",
    status: "draft",
    inspectionLevel: "II",
    severity: "Normal",
    lines: [],
    attachedForms: [],
    canEdit: true,
    ...overrides,
  } as FaiRecord;
}

function renderDetail(rec: FaiRecord): string {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData(["fai-inspection", "record", String(rec.id)], rec);
  queryClient.setQueryData(["fai-inspection", "plans"], []);
  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/fai-inspection/records/${rec.id}`]}>
        <Routes>
          <Route path="/fai-inspection/records/:id" element={<FaiRecordDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("FaiRecordDetailPage — attached validation form", () => {
  it("shows the Open button for an attached CSA form, and no generic result-lines table", () => {
    const html = renderDetail(baseRecord({
      attachedForms: [{ formType: "csa", reportId: 55, title: "CSA Validation Report (FRM-VAL-001)", openPath: "/validation-reports/55" }],
    }));
    // React SSR inserts a harmless hydration comment between adjacent text nodes ("Open " and the title variable) — invisible in the real DOM.
    assert.match(html, /Open\s*(?:<!--[^>]*-->)?\s*CSA Validation Report \(FRM-VAL-001\)/);
    assert.doesNotMatch(html, /Characteristic results/);
  });

  it("shows Attach buttons when nothing is attached and the user can edit", () => {
    const html = renderDetail(baseRecord({ attachedForms: [] }));
    assert.match(html, /Attach CSA Validation Report/);
    assert.match(html, /Attach Fuel Pump Validation/);
  });

  it("hides Attach buttons for a user without edit permission", () => {
    const html = renderDetail(baseRecord({ attachedForms: [], canEdit: false }));
    assert.doesNotMatch(html, /Attach CSA Validation Report/);
  });
});

describe("FaiRecordDetailPage — attach by product family", () => {
  it("offers only the matching form when the record's family is known", () => {
    const html = renderDetail(baseRecord({ attachedForms: [], productType: "regular_gas_lift" }));
    assert.match(html, /Attach Regular Gas Lift Support Validation/);
    assert.doesNotMatch(html, /Attach CSA Validation Report/);
    assert.doesNotMatch(html, /Attach Shock Validation/);
  });

  it("offers every form to pick from when no family matches, and a button for each new type", () => {
    const html = renderDetail(baseRecord({ attachedForms: [], productType: null }));
    for (const label of ["Air Strut", "Air Spring", "Fuel Injector", "Brake Wear Sensor", "Electric Lift Support", "Regular Gas Lift Support", "Coil Spring", "Shock"]) {
      assert.match(html, new RegExp(`Attach ${label} Validation`));
    }
  });

  it("shows Open for an attached new-type form", () => {
    const html = renderDetail(baseRecord({ attachedForms: [{ formType: "shock", reportId: 9, title: "Shock Validation (FRM-VAL-002)", openPath: "/validation-reports/9" }], productType: "shock" }));
    assert.match(html, /Open (<!-- -->)?Shock Validation \(FRM-VAL-002\)/);
    assert.doesNotMatch(html, /Attach Shock Validation/);
  });
});

describe("FaiRecordDetailPage — new record", () => {
  it("treats /records/new as a new record with an editable FAI number", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    queryClient.setQueryData(["fai-inspection", "plans"], []);
    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/fai-inspection/records/new"]}>
          <Routes>
            <Route path="/fai-inspection/records/new" element={<FaiRecordDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    assert.match(html, /New FAI Record/);
    assert.doesNotMatch(html, /Loading…/);
    assert.doesNotMatch(html, /FAI number\*<input[^>]* disabled=""/);
  });
});
