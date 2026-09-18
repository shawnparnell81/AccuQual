import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { QmsForm, QmsFormStatus } from "../../api/types";
import { DataTable, type Column } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { getQmsFormDefinition } from "./qmsFormDefinitions";

const qmsFormHooks = createResourceHooks<QmsForm>("qms-forms");
const STATUSES: QmsFormStatus[] = ["draft", "active", "obsolete"];

export function QmsFormTypePage() {
  const { formType } = useParams();
  const navigate = useNavigate();
  const definition = getQmsFormDefinition(formType!);
  const { data: rows = [], isLoading, isError } = qmsFormHooks.useList({ formType });
  const createForm = qmsFormHooks.useCreate();
  const [statusFilter, setStatusFilter] = useState("");

  const filtered = useMemo(() => rows.filter((r) => !statusFilter || r.status === statusFilter), [rows, statusFilter]);

  if (!definition) return <p className="text-sm text-destructive">Unknown form type "{formType}".</p>;

  const columns: Column<QmsForm>[] = [
    { header: "ID", accessor: (r) => `#${r.id}` },
    { header: "Form No.", accessor: (r) => r.formNo ?? "—" },
    { header: "Revision", accessor: (r) => r.revision ?? "—" },
    { header: "Prepared By", accessor: (r) => r.preparedBy ?? "—" },
    { header: "Approved By", accessor: (r) => r.approvedBy ?? "—" },
    { header: "Status", accessor: (r) => <StatusBadge value={r.status} /> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <button onClick={() => navigate("/qms-forms")} className="text-sm text-muted-foreground hover:text-foreground">
            ← All QMS Forms
          </button>
          <h1 className="text-2xl font-semibold">{definition.title}</h1>
          <p className="text-sm text-muted-foreground">{definition.subtitle}</p>
        </div>
        <button
          onClick={() => createForm.mutate({ formType } as never, { onSuccess: (created) => navigate(`/qms-forms/${formType}/${created.id}`) })}
          disabled={createForm.isPending}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {createForm.isPending ? "Creating…" : `+ New ${definition.title}`}
        </button>
      </div>

      <div className="flex gap-3">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-border px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <DataTable columns={columns} rows={filtered} rowKey={(r) => r.id} isLoading={isLoading} isError={isError} onRowClick={(r) => navigate(`/qms-forms/${formType}/${r.id}`)} />
    </div>
  );
}
