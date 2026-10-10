import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { DataTable } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { TextField, SelectField } from "../../components/forms/Field";
import { useSiteStore } from "../../store/siteStore";
import { LaborClaimCreateForm } from "./LaborClaimCreateForm";
import type { LaborClaim, LaborClaimStatus } from "./laborClaim";

const claimHooks = createResourceHooks<LaborClaim>("labor-claims");

const STATUSES: LaborClaimStatus[] = ["open", "pending", "approved", "denied", "closed"];

function money(value: string | null): string {
  if (value == null || value === "") return "—";
  const amount = Number(value);
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : "—";
}

/** Labor Claims roster. Filters match Warranty Claims. The top-bar plant switcher is the site filter. */
export function LaborClaimsList() {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const params = useMemo(() => {
    const next: Record<string, string> = {};
    if (status) next.status = status;
    if (q) next.q = q;
    if (dateFrom) next.dateFrom = dateFrom;
    if (dateTo) next.dateTo = dateTo;
    return next;
  }, [status, q, dateFrom, dateTo]);
  const { data: rows = [], isLoading, isError } = claimHooks.useList(params);
  const plantKey = useSiteStore((s) => (s.siteScope === "all" ? "all" : s.currentSiteId));
  const { currentSiteId, siteScope } = useSiteStore.getState();
  const visible = useMemo(() => claimsForPlant(rows, currentSiteId, siteScope), [rows, currentSiteId, siteScope, plantKey]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Labor Claims</h1>
        <button onClick={() => setCreateOpen(true)} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
          + New Claim
        </button>
      </div>

      <div className="grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-2 lg:grid-cols-4">
        <TextField label="Search Claim #" placeholder="LC-000123" value={q} onChange={(e) => setQ(e.target.value)} />
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {STATUSES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </SelectField>
        <TextField label="From" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <TextField label="To" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
      </div>

      <DataTable<LaborClaim>
        columns={[
          { header: "Claim #", accessor: (row) => row.claimNumber?.trim() || "" },
          { header: "Status", accessor: (row) => <StatusBadge value={row.status} /> },
          { header: "Customer", accessor: (row) => row.customerName ?? "—" },
          { header: "Part", accessor: (row) => row.partName ?? "—" },
          { header: "Date", accessor: (row) => (row.claimDate ? new Date(row.claimDate).toLocaleDateString() : "—") },
          { header: "Hours", accessor: (row) => row.laborHours ?? "—" },
          { header: "Labor Cost", accessor: (row) => money(row.totalLaborCost) },
        ]}
        rows={visible}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        isError={isError}
        onRowClick={(row) => navigate(`/labor-claims/${row.id}`)}
        emptyMessage="No labor claims match these filters."
      />

      <LaborClaimCreateForm
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => navigate(`/labor-claims/${created.id}`, { state: { freshForm: true } })}
      />
    </div>
  );
}

/** The top-bar plant switcher is the filter. "All plants" and a plant that has not loaded yet keep every row. A chosen plant keeps its own claims and claims that were never assigned. */
export function claimsForPlant(rows: readonly LaborClaim[], siteId: number | null, siteScope: "all" | null): LaborClaim[] {
  if (siteScope === "all" || siteId == null) return [...rows];
  return rows.filter((row) => row.siteId == null || row.siteId === siteId);
}
