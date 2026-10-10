import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import type { Capa } from "../../api/types";
import { DataTable, type Column } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { Modal } from "../../components/modals/Modal";
import { TextAreaField } from "../../components/forms/Field";
import { NcrSearchField } from "../../components/forms/NcrSearchField";
import { useVisibleNcrs } from "../../hooks/useVisibleNcrs";
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
import { RecordNumberField, duplicateNumberError } from "../../components/forms/RecordNumberField";
import { showRecordNumber } from "../../lib/userRecordNumber";

const capaHooks = createResourceHooks<Capa>("capa");

export function CapaListPage() {
  const { canEdit, reason } = usePlantWrite("capa");
  const { label } = usePersonDirectory();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: capas = [], isLoading, isError } = capaHooks.useList();
  const { rows: ncrs, isLoading: ncrsLoading } = useVisibleNcrs();
  const createCapa = capaHooks.useCreate();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("new") !== "1") return;
    if (canEdit) setCreateOpen(true);
    const next = new URLSearchParams(params);
    next.delete("new");
    setParams(next, { replace: true });
  }, [canEdit, params, setParams]);
  const view: "list" | "board" = params.get("view") === "board" ? "board" : "list";
  const [form, setForm] = useState<{ ncrId: number | null; rootCause: string; recordNumber: string }>({ ncrId: null, rootCause: "", recordNumber: "" });
  const [numberError, setNumberError] = useState<string | null>(null);

  const columns: Column<Capa>[] = [
    { header: "CAPA No.", accessor: (c) => showRecordNumber(c.recordNumber) },
    { header: "NCR", accessor: (c) => (c.ncrId ? "Linked" : "Not linked") },
    { header: "State", accessor: (c) => <StatusBadge value={c.status} label={statusPhrase(c.status)} /> },
    { header: "Owner", accessor: (c) => label(c.ownerId) },
    { header: "Due", accessor: (c) => duePhrase(c.dueDate, c.status === "closed") },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">CAPA</h1>
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

      <Modal title="Open a CAPA" isOpen={createOpen} onClose={() => { setCreateOpen(false); setPendingFiles([]); }}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              try {
                const created = await createCapa.mutateAsync({
                  recordNumber: form.recordNumber.trim() || null,
                  ncrId: form.ncrId ?? undefined,
                  rootCause: form.rootCause || undefined,
                });
                setCreateOpen(false);
                setForm({ ncrId: null, rootCause: "", recordNumber: "" });
                queryClient.setQueriesData<Capa[]>({ queryKey: ["capa"] }, (current) => {
                  if (!Array.isArray(current)) return current;
                  if (current.some((row) => row.id === created.id)) return current;
                  return [created, ...current];
                });
                const files = pendingFiles;
                setPendingFiles([]);
                if (files.length > 0) {
                  const result = await uploadPendingAttachments("capa", created.id, files);
                  if (result.failed.length > 0) toast.error(`Fix opened, but these files didn't attach: ${result.failed.join(", ")}. Add them on the fix page.`);
                }
                navigate(`/capa/${created.id}`);
              } catch (err) {
                const message = extractErrorMessage(err, "Couldn't open this fix. Check the NCR and try again.");
                setNumberError(duplicateNumberError(message));
                toast.error(message);
              }
            })();
          }}
        >
          <RecordNumberField label="CAPA No." value={form.recordNumber} error={numberError} onChange={(value) => { setNumberError(null); setForm({ ...form, recordNumber: value }); }} />
          <NcrSearchField ncrs={ncrs} loading={ncrsLoading} value={form.ncrId} onChange={(ncrId) => setForm({ ...form, ncrId })} />
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
