import { useMemo, useState } from "react";
import { createResourceHooks } from "../../api/resourceHooks";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useToast } from "../shared/ToastProvider";
import { useSavedViews } from "../../hooks/useSavedViews";
import { DataTable, type Column } from "../tables/DataTable";
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
   * Filtering stays client-side over the already-fetched list (this
   * component has never paginated server-side), matching a plain
   * substring, case-insensitive. Omitted entirely by default, so every
   * existing caller renders exactly as before.
   */
  searchable?: (row: T) => string;
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
}: ResourceListPageProps<T>) {
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const toast = useToast();
  const hooks = createResourceHooks<T>(resource);
  const { data: rows = [], isLoading, isError } = hooks.useList();
  const createMutation = hooks.useCreate();
  const { views, saveView, removeView } = useSavedViews(resource);

  const visibleRows = useMemo(() => {
    if (!searchable || !search.trim()) return rows;
    const needle = search.trim().toLowerCase();
    return rows.filter((r) => searchable(r).toLowerCase().includes(needle));
  }, [rows, search, searchable]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {createFields && (
          <button onClick={() => setCreateOpen(true)} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
            + New
          </button>
        )}
      </div>

      {searchable && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${title.toLowerCase()}…`}
              className="w-64 rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm"
            />
          </div>
          {search.trim() && (
            <button
              onClick={() => {
                const label = window.prompt("Save this search as:");
                if (label?.trim()) saveView({ label: label.trim(), searchText: search });
              }}
              title="Save current search"
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-secondary"
            >
              <Bookmark size={13} /> Save view
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
        </div>
      )}

      <DataTable columns={columns} rows={visibleRows} rowKey={(r) => r.id} isLoading={isLoading} isError={isError} onRowClick={onRowClick} emptyMessage={searchable && search.trim() ? "No records match this search." : undefined} />

      {createFields && (
        <Modal title={`Create ${title}`} isOpen={createOpen} onClose={() => setCreateOpen(false)}>
          <GenericCreateForm
            fields={createFields}
            onSubmit={(values) =>
              createMutation.mutate(values as never, {
                onSuccess: (created) => {
                  setCreateOpen(false);
                  onCreated?.(created);
                },
                // Previously missing entirely — every module sharing this
                // component failed dead silent on any validation, permission,
                // or network error (see the QA sweep review).
                onError: (err) => toast.error(extractErrorMessage(err, `Couldn't create ${title.toLowerCase()}.`)),
              })
            }
          />
        </Modal>
      )}
    </div>
  );
}
