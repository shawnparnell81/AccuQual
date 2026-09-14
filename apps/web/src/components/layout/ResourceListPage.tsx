import { useState } from "react";
import { createResourceHooks } from "../../api/resourceHooks";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useToast } from "../shared/ToastProvider";
import { DataTable, type Column } from "../tables/DataTable";
import { Modal } from "../modals/Modal";
import { GenericCreateForm, type FieldSpec } from "../forms/GenericCreateForm";

interface ResourceListPageProps<T extends { id: number }> {
  title: string;
  resource: string;
  columns: Column<T>[];
  createFields?: FieldSpec[];
  onRowClick?: (row: T) => void;
  /** Called with the newly-created row once it's saved — e.g. navigate to its detail page. */
  onCreated?: (row: T) => void;
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
}: ResourceListPageProps<T>) {
  const [createOpen, setCreateOpen] = useState(false);
  const toast = useToast();
  const hooks = createResourceHooks<T>(resource);
  const { data: rows = [], isLoading } = hooks.useList();
  const createMutation = hooks.useCreate();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {createFields && (
          <button onClick={() => setCreateOpen(true)} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
            + New
          </button>
        )}
      </div>

      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} isLoading={isLoading} onRowClick={onRowClick} />

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
