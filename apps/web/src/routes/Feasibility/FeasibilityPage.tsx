import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { FeasibilityReview } from "../../api/types";
import { DataTable, type Column } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { Modal } from "../../components/modals/Modal";
import { TextField, TextAreaField } from "../../components/forms/Field";
import { FEASIBILITY_STATUSES } from "../../components/shared/feasibilityConstants";

const feasibilityHooks = createResourceHooks<FeasibilityReview>("feasibility");

const emptyForm = { title: "", description: "", department: "" };

/**
 * Feasibility Review list — ONE unified module across every source type
 * (NCR, Supplier, Complaints, PPAP, Change Management, Work Orders,
 * Requisitions, PO, RMA), not nine separate ones. Manual/standalone reviews
 * can be created here too (sourceType left unset) — most real reviews start
 * from a "Feasibility Review" button on the relevant record's own page.
 */
export function FeasibilityPage() {
  const navigate = useNavigate();
  const { data: reviews = [], isLoading } = feasibilityHooks.useList();
  const createFeasibility = feasibilityHooks.useCreate();
  const [statusFilter, setStatusFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const filtered = useMemo(() => reviews.filter((r) => !statusFilter || r.status === statusFilter), [reviews, statusFilter]);

  const columns: Column<FeasibilityReview>[] = [
    { header: "ID", accessor: (r) => `#${r.id}` },
    { header: "Title", accessor: (r) => r.title },
    { header: "Source", accessor: (r) => (r.sourceType ? `${r.sourceType.replace(/_/g, " ")} #${r.sourceId}` : "manual") },
    { header: "Decision", accessor: (r) => (r.decision ? <StatusBadge value={r.decision} /> : "—") },
    { header: "Score", accessor: (r) => r.overallScore ?? "—" },
    { header: "Status", accessor: (r) => <StatusBadge value={r.status} /> },
    { header: "Department", accessor: (r) => r.department ?? "—" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Feasibility Review</h1>
          <p className="text-sm text-muted-foreground">One module across NCR, Supplier, Complaints, PPAP, Change Mgmt, Work Orders, Requisitions, PO, and RMA.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate("/feasibility/dashboard")} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Dashboard
          </button>
          <button onClick={() => setCreateOpen(true)} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
            + New Review
          </button>
        </div>
      </div>

      <div className="flex gap-3">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-border px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {FEASIBILITY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <DataTable columns={columns} rows={filtered} rowKey={(r) => r.id} isLoading={isLoading} onRowClick={(r) => navigate(`/feasibility/${r.id}`)} />

      <Modal title="Create Feasibility Review" isOpen={createOpen} onClose={() => setCreateOpen(false)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            createFeasibility.mutate(
              { title: form.title, description: form.description || undefined, department: form.department || undefined } as never,
              {
                onSuccess: (created) => {
                  setCreateOpen(false);
                  setForm(emptyForm);
                  navigate(`/feasibility/${created.id}`);
                },
              }
            );
          }}
        >
          <TextField label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <TextAreaField label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <TextField label="Owning department (optional)" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="quality, engineering, production…" />
          <button type="submit" disabled={createFeasibility.isPending} className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {createFeasibility.isPending ? "Creating…" : "Create"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
