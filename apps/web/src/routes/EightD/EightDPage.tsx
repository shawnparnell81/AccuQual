import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ResourceListPage } from "../../components/layout/ResourceListPage";
import { Modal } from "../../components/modals/Modal";
import { createResourceHooks } from "../../api/resourceHooks";
import { useCanEditWorkflow } from "../../hooks/useWorkflowAccess";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useToast } from "../../components/shared/ToastProvider";
import type { Ncr } from "../../api/types";

interface EightDReport {
  id: number;
  ncrId: number | null;
  currentStep: number;
}

const eightDHooks = createResourceHooks<EightDReport>("8d");
const ncrHooks = createResourceHooks<Ncr>("ncr");

function NcrPicker({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const { data: ncrs = [], isLoading } = ncrHooks.useList();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = ncrs.find((ncr) => ncr.id === value) ?? null;
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = needle
      ? ncrs.filter((ncr) => String(ncr.id).includes(needle) || ncr.title.toLowerCase().includes(needle))
      : ncrs;
    return rows.slice(0, 12);
  }, [ncrs, query]);

  return (
    <div className="relative flex flex-col gap-1 text-sm">
      <span className="text-xs font-semibold text-muted-foreground">Linked NCR (optional)</span>
      <input
        aria-label="Search NCRs"
        aria-expanded={open}
        aria-controls="ncr-picker-list"
        role="combobox"
        placeholder="Search by NCR number or title"
        value={selected && !open ? `NCR #${selected.id} — ${selected.title}` : query}
        onChange={(event) => {
          setQuery(event.target.value);
          if (value != null) onChange(null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="rounded-md border border-border bg-background px-3 py-2"
      />
      {value != null && (
        <button type="button" className="self-start text-xs text-muted-foreground hover:underline" onClick={() => { onChange(null); setQuery(""); }}>
          Clear NCR
        </button>
      )}
      {open && (
        <ul id="ncr-picker-list" role="listbox" className="absolute left-0 right-0 top-full z-20 mt-1 max-h-52 overflow-auto rounded-md border border-border bg-card p-1 shadow-lg">
          {isLoading && <li className="px-2 py-1 text-xs text-muted-foreground">Loading NCRs…</li>}
          {!isLoading && matches.length === 0 && <li className="px-2 py-1 text-xs text-muted-foreground">No matching NCR</li>}
          {matches.map((ncr) => (
            <li key={ncr.id}>
              <button
                type="button"
                role="option"
                className="w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onChange(ncr.id);
                  setQuery("");
                  setOpen(false);
                }}
              >
                NCR #{ncr.id} — {ncr.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Leave this blank to create an 8D that is not tied to an NCR.</p>
    </div>
  );
}

export function EightDPage() {
  const navigate = useNavigate();
  const canEdit = useCanEditWorkflow("8d");
  const toast = useToast();
  const createReport = eightDHooks.useCreate();
  const [createOpen, setCreateOpen] = useState(false);
  const [ncrId, setNcrId] = useState<number | null>(null);

  function openCreate() {
    setNcrId(null);
    setCreateOpen(true);
  }

  function create() {
    createReport.mutate(ncrId ? { ncrId } : {}, {
      onSuccess: (created) => {
        setCreateOpen(false);
        navigate(`/8d/${created.id}`);
      },
      onError: (err) => toast.error(extractErrorMessage(err, "Couldn't create this 8D report.")),
    });
  }

  return (
    <>
      <ResourceListPage<EightDReport>
        title="8D reports"
        resource="8d"
        canCreate={false}
        onRowClick={(row) => navigate(`/8d/${row.id}`)}
        columns={[
          { header: "ID", accessor: (row) => `#${row.id}` },
          { header: "Linked NCR", accessor: (row) => (row.ncrId ? `#${row.ncrId}` : "—") },
          { header: "Current step", accessor: (row) => `D${row.currentStep}` },
        ]}
        headerActions={
          canEdit ? (
            <button type="button" onClick={openCreate} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
              + New
            </button>
          ) : null
        }
      />
      <Modal title="Create 8D report" isOpen={createOpen} onClose={() => setCreateOpen(false)}>
        <div className="flex flex-col gap-4">
          <NcrPicker value={ncrId} onChange={setNcrId} />
          <button type="button" onClick={create} disabled={createReport.isPending} className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {createReport.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </Modal>
    </>
  );
}
