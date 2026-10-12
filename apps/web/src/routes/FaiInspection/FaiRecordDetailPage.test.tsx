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
