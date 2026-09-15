import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { RiskAssessment } from "../../api/types";
import { DataTable, type Column } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { Modal } from "../../components/modals/Modal";
import { TextField, TextAreaField, SelectField } from "../../components/forms/Field";
import { RISK_CATEGORIES, RISK_STATUSES } from "../../components/shared/riskConstants";

const riskHooks = createResourceHooks<RiskAssessment>("risk");

const emptyForm = { title: "", description: "", category: "process", processArea: "", department: "", severity: "", probability: "" };

/**
 * Risk / FMEA list — the Risk Register (general severity x probability
 * tracking) plus a link to its Dashboard. FMEA line items themselves still
 * live one level down, on each risk's own detail page, exactly as before.
 */
export function RiskPage() {
  const navigate = useNavigate();
  const { data: risks = [], isLoading } = riskHooks.useList();
  const createRisk = riskHooks.useCreate();
  const [statusFilter, setStatusFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const filtered = useMemo(() => risks.filter((r) => !statusFilter || r.status === statusFilter), [risks, statusFilter]);

  const columns: Column<RiskAssessment>[] = [
    { header: "ID", accessor: (r) => `#${r.id}` },
    { header: "Title", accessor: (r) => r.title },
    { header: "Category", accessor: (r) => r.category ?? "—" },
    { header: "Level", accessor: (r) => (r.riskLevel ? <StatusBadge value={r.riskLevel} /> : "—") },
    { header: "Score", accessor: (r) => r.riskScore ?? "—" },
    { header: "Status", accessor: (r) => <StatusBadge value={r.status} /> },
    { header: "Department", accessor: (r) => r.department ?? "—" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Risk / FMEA</h1>
          <p className="text-sm text-muted-foreground">
            The Risk Register — distinct from AI Insights' supplier risk score and the Digital Twin's simulation heatmap; see each page's own label.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate("/risk/dashboard")} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Dashboard
          </button>
          <button onClick={() => setCreateOpen(true)} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
            + New Risk
          </button>
        </div>
      </div>

      <div className="flex gap-3">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-border px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {RISK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <DataTable columns={columns} rows={filtered} rowKey={(r) => r.id} isLoading={isLoading} onRowClick={(r) => navigate(`/risk/${r.id}`)} />

      <Modal title="Create Risk" isOpen={createOpen} onClose={() => setCreateOpen(false)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            createRisk.mutate(
              {
                title: form.title,
                description: form.description || undefined,
                category: form.category as never,
                processArea: form.processArea || undefined,
                department: form.department || undefined,
                severity: form.severity ? Number(form.severity) : undefined,
                probability: form.probability ? Number(form.probability) : undefined,
              } as never,
              {
                onSuccess: (created) => {
                  setCreateOpen(false);
                  setForm(emptyForm);
                  navigate(`/risk/${created.id}`);
                },
              }
            );
          }}
        >
          <TextField label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <TextAreaField label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <SelectField label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {RISK_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectField>
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Severity (1-5)" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              <option value="">—</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </SelectField>
            <SelectField label="Probability (1-5)" value={form.probability} onChange={(e) => setForm({ ...form, probability: e.target.value })}>
              <option value="">—</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </SelectField>
          </div>
          <TextField label="Process area (optional)" value={form.processArea} onChange={(e) => setForm({ ...form, processArea: e.target.value })} />
          <TextField label="Owning department (optional)" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="quality, engineering, production…" />
          <button type="submit" disabled={createRisk.isPending} className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {createRisk.isPending ? "Creating…" : "Create"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
