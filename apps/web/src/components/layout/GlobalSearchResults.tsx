import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useOpenTab } from "../../hooks/useOpenTab";
import type { SearchResult } from "../../api/types";

const TYPE_TO_ICON: Record<SearchResult["type"], string> = {
  NCR: "ncr",
  CAPA: "capa",
  PO: "erp",
  WO: "default",
  Audit: "audit",
  Supplier: "supplier",
  Item: "inventory",
  Training: "training",
  Calibration: "calibration",
};

/**
 * The real global-search results — GET /search?q=..., debounced. Lives
 * inside TopNav's existing search dropdown alongside its (unchanged)
 * client-side module-name filter, as a separate "Records" section, rather
 * than a second competing search box. Clicking a result is this app's one
 * "open in a new tab" entry point (see useOpenTab) — normal nav links keep
 * navigating in place exactly as before.
 */
export function GlobalSearchResults({ query, onSelect }: { query: string; onSelect: () => void }) {
  const debouncedQuery = useDebouncedValue(query.trim(), 250);
  const openTab = useOpenTab();

  const { data, isFetching } = useQuery<{ results: SearchResult[] }>({
    queryKey: ["search", debouncedQuery],
    queryFn: async () => (await apiClient.get("/search", { params: { q: debouncedQuery } })).data,
    enabled: debouncedQuery.length > 0,
  });

  if (!debouncedQuery) return null;
  const results = data?.results ?? [];
  if (!isFetching && results.length === 0) return null;

  return (
    <div className="border-t border-border p-1">
      <p className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {isFetching ? "Searching…" : `Records (${results.length})`}
      </p>
      {results.map((r) => (
        <button
          key={`${r.type}-${r.id}`}
          onClick={() => {
            openTab({ path: r.path, title: r.label, icon: TYPE_TO_ICON[r.type] });
            onSelect();
          }}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted"
        >
          <span className="flex-none rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-foreground">{r.type}</span>
          <span className="truncate">{r.label}</span>
        </button>
      ))}
    </div>
  );
}
