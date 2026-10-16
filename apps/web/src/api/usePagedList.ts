import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import { apiClient } from "./client";
import { useSiteStore } from "../store/siteStore";
import { LIST_STEP } from "../components/tables/LoadMore";

export type SortDir = "asc" | "desc";
export interface ListSort {
  key: string;
  dir: SortDir;
}

interface Page<T> {
  rows: T[];
  total: number;
  statusCounts: Record<string, number> | null;
  listCounts: Record<string, number> | null;
}

function readCounts(header: unknown): Record<string, number> | null {
  if (typeof header !== "string" || !header) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(header)) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : null;
  } catch {
    return null;
  }
}

/** Cache key of one paged list. Starts with the resource so saves still refresh it. */
export function pagedListKey(
  root: string,
  path: string,
  shape: { siteId?: number | null; params?: Record<string, unknown>; search?: string; sort?: ListSort | null; counts?: boolean } = {},
) {
  return [root, "paged", path, shape.siteId ?? null, shape.params ?? {}, shape.search ?? "", shape.sort?.key ?? null, shape.sort?.dir ?? null, shape.counts ?? false] as const;
}

/** Puts rows in the cache as a loaded first page (tests and optimistic updates). */
export function pagedListData<T>(rows: T[], total = rows.length) {
  return { pages: [{ rows, total, statusCounts: null, listCounts: null }], pageParams: [0] };
}

/** Waits for typing to settle before a search goes to the server. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * One long list read from the server a page at a time. Search, sort and
 * filters run on the server so a register of any size opens on its first
 * page. The cache key starts with `root`, so the module's existing
 * invalidate-on-save still refreshes it.
 */
export interface PagedListOptions {
  /** First cache key part, normally the resource name, so saves refresh the list. */
  root?: string;
  params?: Record<string, string | number | boolean | undefined | null>;
  search?: string;
  sort?: ListSort | null;
  siteScoped?: boolean;
  counts?: boolean;
  pageSize?: number;
  enabled?: boolean;
}

export function usePagedList<T>(path: string, options: PagedListOptions = {}) {
  const pageSize = options.pageSize ?? LIST_STEP;
  const q = useDebounced((options.search ?? "").trim());
  const siteId = useSiteStore((s) => (options.siteScoped ? s.currentSiteId : null));
  const root = options.root ?? path.replace(/^\//, "");
  const params = options.params ?? {};
  const query = useInfiniteQuery({
    queryKey: pagedListKey(root, path, { siteId, params, search: q, sort: options.sort ?? null, counts: options.counts ?? false }),
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    enabled: options.enabled !== false,
    queryFn: async ({ pageParam }): Promise<Page<T>> => {
      const response = await apiClient.get<T[]>(path, {
        params: {
          ...Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "")),
          limit: pageSize,
          offset: pageParam,
          ...(q ? { q } : {}),
          ...(options.sort ? { sort: options.sort.key, dir: options.sort.dir } : {}),
          ...(options.counts && pageParam === 0 ? { counts: "status" } : {}),
        },
      });
      const rows = Array.isArray(response.data) ? response.data : [];
      const header = response.headers?.["x-total-count"];
      const total = header == null ? pageParam + rows.length + (rows.length === pageSize ? 1 : 0) : Number(header);
      return { rows, total, statusCounts: readCounts(response.headers?.["x-status-counts"]), listCounts: readCounts(response.headers?.["x-list-counts"]) };
    },
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.rows.length, 0);
      return last.rows.length === pageSize && loaded < last.total ? loaded : undefined;
    },
  });
  const rows = useMemo(() => (query.data?.pages ?? []).flatMap((page) => page.rows), [query.data]);
  const first = query.data?.pages[0];
  return {
    rows,
    total: first?.total ?? null,
    statusCounts: first?.statusCounts ?? null,
    listCounts: first?.listCounts ?? null,
    search: q,
    isLoading: query.isLoading,
    isError: query.isError,
    isFetching: query.isFetching,
    loadingMore: query.isFetchingNextPage,
    hasMore: Boolean(query.hasNextPage),
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
  };
}

export type PagedList<T> = ReturnType<typeof usePagedList<T>>;

/**
 * A paged list wired for DataTable: the table's filter box searches the
 * server and its headers sort on the server. Spread `server` into DataTable.
 */
export function useServerTable<T>(
  path: string,
  options: Omit<PagedListOptions, "search" | "sort"> & { defaultSort?: ListSort } = {},
) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ListSort | null>(options.defaultSort ?? null);
  const list = usePagedList<T>(path, { counts: true, ...options, search, sort });
  return {
    rows: list.rows,
    isLoading: list.isLoading,
    isError: list.isError,
    list,
    server: {
      total: list.total,
      statusCounts: list.statusCounts,
      hasMore: list.hasMore,
      loadingMore: list.loadingMore,
      loadMore: list.loadMore,
      sort,
      onSort: setSort,
      search,
      onSearch: setSearch,
    },
  };
}
