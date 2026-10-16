import { useEffect, useState, type ReactNode } from "react";
import { createResourceHooks, isSiteScopedResource } from "../../api/resourceHooks";
import { usePagedList, type ListSort } from "../../api/usePagedList";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { duplicateNumberError } from "../forms/RecordNumberField";
import { useToast } from "../shared/ToastProvider";
import { useSavedViews } from "../../hooks/useSavedViews";
import { DataTable, type Column } from "../tables/DataTable";
import { FilterBar, PageHeader, SummaryCards, summarizeCounts } from "./PageHeader";
import { Modal } from "../modals/Modal";
import { GenericCreateForm, type FieldSpec } from "../forms/GenericCreateForm";
import { Search, Bookmark, X } from "lucide-react";

interface ResourceListPageProps<T extends { id: number }> {
  title: string;
  resource: string;
  columns: Column<T>[];
  createFields?: FieldSpec[];
  onRowClick?: (row: T) => void;
  /** Called with the newly-created row once it's saved — e.g. navigate to its detail page. */
  onCreated?: (row: T) => void;
  /**
   * Opts into a free-text search box + saved-views ("save current search" /
   * load a saved one), keyed by `resource` — e.g. `(r) => \`${r.title} ${r.status}\``.
   * The search runs on the server over the record's text fields, so it
   * finds rows that are not loaded yet. Omitted, the page has no search box.
   */
  searchable?: (row: T) => string;
  /** When false, the create button stays hidden. Omit it to keep the old always-on create button. */
  canCreate?: boolean;
  /** Shown when the viewer can look but not add — department or plant. */
  accessNote?: string | null;
  /** Extra buttons next to "+ New" (for example Import from Excel). */
  headerActions?: ReactNode;
  /** Extra controls above the table, such as a list filter. Omitted callers are unchanged. */
  extraFilters?: ReactNode;
  /** Server filters for the list, such as `{ statusNot: "obsolete" }`. */
  listParams?: Record<string, string | number | boolean | undefined | null>;
  /** Sort on first open. Defaults to newest first. */
  defaultSort?: ListSort;
  /** Open the create dialog on arrival, used by the dashboard's Schedule audit button. */
  createOnMount?: boolean;
  /** Dialog title. Defaults to "Create {title}". */
  createTitle?: string;
}

/**
 * A complete list page (table + optional quick-create modal) for a simple
 * master-data module — used by Audits/Documents/Training/Change/Risk/
 * Supplier/Calibration/Complaints/8D so each still gets a real, working page
 * without re-implementing the same list+create shell nine times over.
 */
export function ResourceListPage<T extends { id: number }>({
  title,
  resource,
  columns,
  createFields,
  onRowClick,
  onCreated,
  searchable,
  canCreate,
  accessNote,
  headerActions,
  createOnMount,
  createTitle,
  extraFilters,
  listParams,
  defaultSort,
}: ResourceListPageProps<T>) {
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  useEffect(() => {
    if (createOnMount) setCreateOpen(true);
  }, [createOnMount]);
  const [search, setSearch] = useState("");
  const toast = useToast();
  const hooks = createResourceHooks<T>(resource);
  const [sort, setSort] = useState<ListSort | null>(defaultSort ?? null);
  // A page at a time from the server: a 5,000-row register opens on its first 150.
  const list = usePagedList<T>(`/${resource}`, {
    root: resource,
    params: listParams,
    search: searchable ? search : "",
    sort,
    siteScoped: isSiteScopedResource(resource),
    counts: true,
  });
  const createMutation = hooks.useCreate();
  const { views, saveView, removeView } = useSavedViews(resource);
  const total = list.total ?? list.rows.length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumbs={[{ label: "Home", to: "/" }, { label: title }]}
        title={title}
        description={accessNote}
        actions={
          <>
            {headerActions}
            {createFields && canCreate !== false && (
              <button onClick={() => { setCreateError(null); setCreateOpen(true); }} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
                New
              </button>
            )}
          </>
        }
      />
      <SummaryCards items={summarizeCounts(total, list.statusCounts)} />
      {(searchable || extraFilters) && (
        <FilterBar>
          {searchable && (
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${title.toLowerCase()}…`}
                aria-label={`Search ${title}`}
                className="w-64 border border-border bg-background py-1.5 pl-8 pr-3 text-sm"
              />
            </div>
          )}
          {extraFilters}
          {searchable && search.trim() && (
            <button
              onClick={() => {
                const label = window.prompt("Save this search as:");
                if (label?.trim()) saveView({ label: label.trim(), searchText: search });
              }}
              title="Save current search"
              className="rounded-md border border-border px-2 py-1.5 text-sm hover:bg-secondary"
            >
              <Bookmark size={13} className="mr-1 inline" /> Save view
            </button>
          )}
          {views.map((v) => (
            <span key={v.label} className="flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs">
              <button onClick={() => setSearch(v.searchText)} className="hover:underline">
                {v.label}
              </button>
              <button onClick={() => removeView(v.label)} title="Remove saved view" className="text-muted-foreground hover:text-foreground">
                <X size={11} />
              </button>
            </span>
          ))}
        </FilterBar>
      )}

      <DataTable
        columns={columns}
        rows={list.rows}
        rowKey={(r) => r.id}
        isLoading={list.isLoading}
        isError={list.isError}
        onRowClick={onRowClick}
        listChrome={false}
        emptyMessage={searchable && search.trim() ? "No records match this search." : undefined}
        server={{ total: list.total, hasMore: list.hasMore, loadingMore: list.loadingMore, loadMore: list.loadMore, sort, onSort: setSort }}
      />

      {createFields && (
        <Modal title={createTitle ?? `Create ${title}`} isOpen={createOpen} onClose={() => { setCreateError(null); setCreateOpen(false); }}>
          <GenericCreateForm
            fields={createFields}
            error={createError}
            onSubmit={(values) =>
              createMutation.mutate(values as never, {
                onSuccess: (created) => {
                  setCreateError(null);
                  setCreateOpen(false);
                  onCreated?.(created);
                },
                onError: (err) => {
                  const message = extractErrorMessage(err, `Couldn't create ${title.toLowerCase()}.`);
                  setCreateError(duplicateNumberError(message));
                  toast.error(message);
                },
              })
            }
          />
        </Modal>
      )}
    </div>
  );
}
