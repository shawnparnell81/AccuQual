import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { Capa } from "../../api/types";
import { DataTable, type Column } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { Modal } from "../../components/modals/Modal";
import { TextField, TextAreaField } from "../../components/forms/Field";
import { DetailsDisclosure } from "../../components/forms/DetailsDisclosure";
import { duePhrase, statusPhrase } from "../../lib/opsLanguage";
import { usePlantWrite } from "../../hooks/usePlantWrite";
import { CurrentPlantNote } from "../../components/layout/CurrentPlantNote";
import { usePersonDirectory } from "../../hooks/usePersonDirectory";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { PendingFilesField } from "../../components/shared/PendingFilesField";
import { SegmentedTabs } from "../../components/dashboard/kit";
import { uploadPendingAttachments } from "../../lib/attachments";
import { CapaBoard } from "./CapaBoard";

const capaHooks = createResourceHooks<Capa>("capa");

export function CapaListPage() {
  const { canEdit, reason } = usePlantWrite("capa");
  const { label } = usePersonDirectory();
  const toast = useToast();
  const { data: capas = [], isLoading, isError } = capaHooks.useList();
  const createCapa = capaHooks.useCreate();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [params, setParams] = useSearchParams();
  const view: "list" | "board" = params.get("view") === "board" ? "board" : "list";
  const [form, setForm] = useState<{ ncrId: string; rootCause: string }>({ ncrId: "", rootCause: "" });

  const columns: Column<Capa>[] = [
    { header: "ID", accessor: (c) => `#${c.id}` },
    { header: "Issue", accessor: (c) => (c.ncrId ? `#${c.ncrId}` : "Not linked") },
    { header: "State", accessor: (c) => <StatusBadge value={c.status} label={statusPhrase(c.status)} /> },
    { header: "Owner", accessor: (c) => label(c.ownerId) },
    { header: "Due", accessor: (c) => duePhrase(c.dueDate, c.status === "closed") },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Fixes</h1>
          <p className="text-sm text-muted-foreground">Corrective actions (CAPA). Start from the issue they belong to.</p>
          <CurrentPlantNote />
        </div>
        {canEdit && (
          <button
            onClick={() => setCreateOpen(true)}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            Open a fix
          </button>
        )}
      </div>
      {reason && <p className="text-sm text-muted-foreground">{reason}</p>}

      <SegmentedTabs
        tabs={[
          { key: "list", label: "List" },
          { key: "board", label: "Board" },
        ]}
        value={view}
        onChange={(key) => setParams(key === "list" ? {} : { view: key }, { replace: true })}
      />

      {view === "board" ? (
        <>
          <p className="text-xs text-muted-foreground">Drag a fix to the next column to move it forward. Each step asks for what it needs first.</p>
          <CapaBoard capas={isLoading ? [] : capas} canEdit={canEdit} />
        </>
      ) : (
      <DataTable
        columns={columns}
        rows={capas}
        rowKey={(c) => c.id}
        isLoading={isLoading}
        isError={isError}
        errorMessage="Couldn't load fixes. Refresh the page and try again."
        emptyMessage="No fixes yet. Open one from an issue so the corrective action has a home."
        onRowClick={(c) => navigate(`/capa/${c.id}`)}
      />
      )}

      <Modal title="Open a fix" isOpen={createOpen} onClose={() => { setCreateOpen(false); setPendingFiles([]); }}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            createCapa.mutate(
              { ncrId: form.ncrId ? Number(form.ncrId) : undefined, rootCause: form.rootCause || undefined },
              {
                onSuccess: async (created) => {
                  const files = pendingFiles;
                  setPendingFiles([]);
                  setCreateOpen(false);
                  if (files.length > 0) {
                    const result = await uploadPendingAttachments("capa", created.id, files);
                    if (result.failed.length > 0) toast.error(`Fix opened, but these files didn't attach: ${result.failed.join(", ")}. Add them on the fix page.`);
                  }
                  navigate(`/capa/${created.id}`);
                },
                onError: (err) => toast.error(extractErrorMessage(err, "Couldn't open this fix. Check the issue number and try again.")),
              }
            );
          }}
        >
          <TextField
            label="Issue number"
            type="number"
            value={form.ncrId}
            onChange={(e) => setForm({ ...form, ncrId: e.target.value })}
            placeholder="The NCR this fix belongs to"
          />
          <DetailsDisclosure label="Add the cause now">
            <TextAreaField label="Cause" value={form.rootCause} onChange={(e) => setForm({ ...form, rootCause: e.target.value })} />
          </DetailsDisclosure>
          <PendingFilesField files={pendingFiles} onChange={setPendingFiles} />
          <button type="submit" className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground">
            Open fix
          </button>
        </form>
      </Modal>
    </div>
  );
}
