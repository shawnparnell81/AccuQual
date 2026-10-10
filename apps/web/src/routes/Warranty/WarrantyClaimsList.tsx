import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { DataTable } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { TextField, SelectField } from "../../components/forms/Field";
import { useSiteStore } from "../../store/siteStore";
import { WarrantyClaimCreateForm } from "./WarrantyClaimCreateForm";
import { formatDate } from "../../lib/dates";
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
  // Subscribe so a top-bar plant change redraws this list, then read the store.
  // The hook's server snapshot stays at the first value, so the filter uses getState.
  const plantKey = useSiteStore((s) => (s.siteScope === "all" ? "all" : s.currentSiteId));
  const { currentSiteId, siteScope } = useSiteStore.getState();
  const visible = useMemo(() => claimsForPlant(rows, currentSiteId, siteScope), [rows, currentSiteId, siteScope, plantKey]);

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
          { header: "Claim #", accessor: (c) => c.claimNumber?.trim() || "" },
          { header: "Status", accessor: (c) => <StatusBadge value={c.status} /> },
          { header: "Serial #", accessor: (c) => c.serialNumber ?? "—" },
          { header: "Failure Date", accessor: (c) => formatDate(c.failureDate) },
          { header: "Est. Cost", accessor: (c) => (c.warrantyCostEstimate ? `$${Number(c.warrantyCostEstimate).toFixed(2)}` : "—") },
          { header: "Actual Cost", accessor: (c) => (c.warrantyActualCost ? `$${Number(c.warrantyActualCost).toFixed(2)}` : "—") },
        ]}
        rows={visible}
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

/** The top-bar plant switcher is the filter. "All plants" and a plant that has not loaded yet keep every row. A chosen plant keeps its own claims and claims that were never assigned. */
export function claimsForPlant(rows: readonly WarrantyClaim[], siteId: number | null, siteScope: "all" | null): WarrantyClaim[] {
  if (siteScope === "all" || siteId == null) return [...rows];
  return rows.filter((row) => row.siteId == null || row.siteId === siteId);
}
