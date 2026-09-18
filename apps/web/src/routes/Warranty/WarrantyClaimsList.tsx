import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { DataTable } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { TextField, SelectField } from "../../components/forms/Field";
import { WarrantyClaimCreateForm } from "./WarrantyClaimCreateForm";
import type { WarrantyClaim, WarrantyStatus } from "../../api/types";

const claimHooks = createResourceHooks<WarrantyClaim>("warranty/claims");

const STATUSES: WarrantyStatus[] = ["new", "inspection", "supplier_review", "approved", "rejected", "replaced", "repaired", "closed"];

/** Warranty Claims roster — filters run server-side via GET /warranty/claims's query params, same convention as RmaListPage. */
export function WarrantyClaimsList() {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (status) p.status = status;
    if (q) p.q = q;
    if (dateFrom) p.dateFrom = dateFrom;
    if (dateTo) p.dateTo = dateTo;
    return p;
  }, [status, q, dateFrom, dateTo]);
  const { data: rows = [], isLoading, isError } = claimHooks.useList(params);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Warranty Claims</h1>
        <div className="flex gap-2">
          <button onClick={() => navigate("/warranty/dashboard")} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Dashboard
          </button>
          <button onClick={() => setCreateOpen(true)} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
            + New Claim
          </button>
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-2 lg:grid-cols-4">
        <TextField label="Search Claim #" placeholder="WC-000123" value={q} onChange={(e) => setQ(e.target.value)} />
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </SelectField>
        <TextField label="From" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <TextField label="To" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
      </div>

      <DataTable<WarrantyClaim>
        columns={[
          { header: "Claim #", accessor: (c) => c.claimNumber },
          { header: "Customer", accessor: (c) => c.customerName ?? "—" },
          { header: "Status", accessor: (c) => <StatusBadge value={c.status} /> },
          { header: "Serial #", accessor: (c) => c.serialNumber ?? "—" },
          { header: "Failure Date", accessor: (c) => (c.failureDate ? new Date(c.failureDate).toLocaleDateString() : "—") },
          { header: "Est. Cost", accessor: (c) => (c.warrantyCostEstimate ? `$${Number(c.warrantyCostEstimate).toFixed(2)}` : "—") },
          { header: "Actual Cost", accessor: (c) => (c.warrantyActualCost ? `$${Number(c.warrantyActualCost).toFixed(2)}` : "—") },
        ]}
        rows={rows}
        rowKey={(c) => c.id}
        isLoading={isLoading}
        isError={isError}
        onRowClick={(c) => navigate(`/warranty/${c.id}`)}
        emptyMessage="No warranty claims match these filters."
      />

      <WarrantyClaimCreateForm isOpen={createOpen} onClose={() => setCreateOpen(false)} onCreated={(created) => navigate(`/warranty/${created.id}`)} />
    </div>
  );
}
