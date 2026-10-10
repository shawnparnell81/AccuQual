import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/shared/ToastProvider";
import { isLiveTabPath } from "../../lib/tabPaths";
import { useSiteStore } from "../../store/siteStore";
import { ImportedDataPage, importsForPlant, type ImportedRow } from "./ImportedDataPage";

function row(id: number, name: string, siteId: number | null, importedAt: string): ImportedRow {
  return { id, name, type: "O'Reilly's Reports", rowCount: id, sourceFileName: `${name}.csv`, siteId, siteName: siteId == null ? null : `Plant ${siteId}`, importedBy: "Ada", importedAt, deletedAt: null, deleteReason: null };
}

function renderList(rows: ImportedRow[]): string {
  const { siteScope, currentSiteId } = useSiteStore.getState();
  const plantKey = siteScope === "all" ? "all" : currentSiteId;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData(["imported-data", plantKey, false], { available: true, rows });
  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/reporting/imported-data"]}>
        <ToastProvider>
          <ImportedDataPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Imported Data", () => {
  it("lists newest first and keeps the selected plant plus unassigned rows", () => {
    const rows = [row(1, "Older Greer", 1, "2026-10-01"), row(2, "Newer Wellman", 2, "2026-10-09"), row(3, "Unassigned", null, "2026-10-04")];
    assert.deepEqual(importsForPlant(rows, null, "all").map((item) => item.name), ["Newer Wellman", "Unassigned", "Older Greer"]);
    assert.deepEqual(importsForPlant(rows, 2, null).map((item) => item.name), ["Newer Wellman", "Unassigned"]);

    useSiteStore.setState({ currentSiteId: null, siteScope: "all" });
    const all = renderList(rows);
    assert.match(all, /Imported Data/);
    assert.ok(all.indexOf("Newer Wellman") < all.indexOf("Older Greer"));
    assert.match(all, /Unassigned/);

    useSiteStore.setState({ currentSiteId: 2, siteScope: null });
    const plant = renderList(rows);
    assert.match(plant, /Newer Wellman/);
    assert.match(plant, /Unassigned/);
    assert.doesNotMatch(plant, /Older Greer/);
    useSiteStore.setState({ currentSiteId: null, siteScope: null });
  });

  it("opens as one workspace tab and does not scroll inside the page", () => {
    assert.equal(isLiveTabPath("/reporting/imported-data"), true);
    assert.equal(isLiveTabPath("/reporting/imported-data/4"), true);
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ImportedDataPage.tsx"), "utf8");
    assert.doesNotMatch(source, /overflow-y-auto|overflow-auto|h-\[calc\(100vh|100vh/);
  });
});
