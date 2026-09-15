import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { FeasibilityReview, FeasibilityStatus } from "../../api/types";
import { DataTable, type Column } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";

const feasibilityHooks = createResourceHooks<FeasibilityReview>("feasibility");

const STATUSES: FeasibilityStatus[] = ["draft", "final"];

/**
 * Feasibility Review list — "Contract & Project Feasibility Review Form"
 * (QMS-FR-001), Engineering's own document. Reachable from Engineering's
 * nav entry only (plus the Customer Onboarding packet's own "Feasibility
 * Review" button, which creates one and opens it directly rather than
 * landing here) — see feasibility.ts's own schema comment for the scope
 * narrowed down from 9 cross-module integration points to just these two.
 */
export function FeasibilityPage() {
  const navigate = useNavigate();
  const { data: rows = [], isLoading } = feasibilityHooks.useList();
  const createReview = feasibilityHooks.useCreate();
  const [statusFilter, setStatusFilter] = useState("");

  const filtered = useMemo(() => rows.filter((r) => !statusFilter || r.status === statusFilter), [rows, statusFilter]);

  const columns: Column<FeasibilityReview>[] = [
    { header: "ID", accessor: (r) => `#${r.id}` },
    { header: "Customer", accessor: (r) => r.customerName ?? "—" },
    { header: "Part / Project", accessor: (r) => r.partProjectName ?? "—" },
    { header: "RFQ / Quote #", accessor: (r) => r.rfqQuoteNumber ?? "—" },
    {
      header: "Determination",
      accessor: (r) =>
        r.determination ? <span className="capitalize">{r.determination.replace(/_/g, " ")}</span> : <span className="text-muted-foreground">not yet decided</span>,
    },
    { header: "Status", accessor: (r) => <StatusBadge value={r.status} /> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Feasibility Review</h1>
          <p className="text-sm text-muted-foreground">Evaluates technical, operational, regulatory, and commercial feasibility prior to a quote or contract award.</p>
        </div>
        <button
          onClick={() => createReview.mutate({} as never, { onSuccess: (created) => navigate(`/feasibility/${created.id}`) })}
          disabled={createReview.isPending}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {createReview.isPending ? "Creating…" : "+ New Feasibility Review"}
        </button>
      </div>

      <div className="flex gap-3">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-border px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s} className="capitalize">
              {s}
            </option>
          ))}
        </select>
      </div>

      <DataTable columns={columns} rows={filtered} rowKey={(r) => r.id} isLoading={isLoading} onRowClick={(r) => navigate(`/feasibility/${r.id}`)} />
    </div>
  );
}
