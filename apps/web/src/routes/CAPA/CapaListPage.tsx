import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { Capa } from "../../api/types";
import { DataTable, type Column } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { Modal } from "../../components/modals/Modal";
import { TextField, TextAreaField } from "../../components/forms/Field";

const capaHooks = createResourceHooks<Capa>("capa");

export function CapaListPage() {
  const { data: capas = [], isLoading, isError } = capaHooks.useList();
  const createCapa = capaHooks.useCreate();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<{ ncrId: string; rootCause: string }>({ ncrId: "", rootCause: "" });

  const columns: Column<Capa>[] = [
    { header: "ID", accessor: (c) => `#${c.id}` },
    { header: "Linked NCR", accessor: (c) => (c.ncrId ? `#${c.ncrId}` : "—") },
    { header: "Root Cause", accessor: (c) => c.rootCause ?? "—" },
    { header: "Status", accessor: (c) => <StatusBadge value={c.status} /> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Corrective & Preventive Actions</h1>
        <button
          onClick={() => setCreateOpen(true)}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
        >
          + New CAPA
        </button>
      </div>

      <DataTable columns={columns} rows={capas} rowKey={(c) => c.id} isLoading={isLoading} isError={isError} onRowClick={(c) => navigate(`/capa/${c.id}`)} />

      <Modal title="Create CAPA" isOpen={createOpen} onClose={() => setCreateOpen(false)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            createCapa.mutate(
              { ncrId: form.ncrId ? Number(form.ncrId) : undefined, rootCause: form.rootCause || undefined },
              {
                onSuccess: (created) => {
                  setCreateOpen(false);
                  navigate(`/capa/${created.id}`);
                },
              }
            );
          }}
        >
          <TextField
            label="Linked NCR ID (optional)"
            type="number"
            value={form.ncrId}
            onChange={(e) => setForm({ ...form, ncrId: e.target.value })}
          />
          <TextAreaField label="Root Cause (optional)" value={form.rootCause} onChange={(e) => setForm({ ...form, rootCause: e.target.value })} />
          <button type="submit" className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground">
            Create
          </button>
        </form>
      </Modal>
    </div>
  );
}
