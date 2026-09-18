import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { DataTable } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { SelectField, TextField } from "../../components/forms/Field";
import type { CrarClaim, CrarStatus } from "../../api/types";
import { formatDate } from "../../lib/dates";

const crarHooks = createResourceHooks<CrarClaim>("crar");
const STATUSES: CrarStatus[] = ["new", "quality_review", "warranty_review", "completed"];

/** Customer Return Analysis Report roster — Quality creates new ones; Customer Service/Engineering/Purchasing get read (or link-only) access — see departmentAccess.ts's PERMISSION_MATRIX.crar. */
export function CrarListPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (status) p.status = status;
    if (q) p.q = q;
    return p;
  }, [status, q]);
  const { data: rows = [], isLoading, isError } = crarHooks.useList(params);
  const createCrar = crarHooks.useCreate();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Customer Return Analysis Reports</h1>
        <button
          onClick={() =>
            createCrar.mutate(
              {} as never,
              {
                onSuccess: (created) => navigate(`/crar/${created.id}`),
                onError: (err) => toast.error(extractErrorMessage(err, "Couldn't create a new CRAR.")),
              }
            )
          }
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
        >
          + New CRAR
        </button>
      </div>

      <div className="grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-3">
        <TextField label="Search Customer Claim #" value={q} onChange={(e) => setQ(e.target.value)} />
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </SelectField>
      </div>

      <DataTable<CrarClaim>
        columns={[
          { header: "Customer", accessor: (c) => c.customerName ?? "—" },
          { header: "RMA #", accessor: (c) => c.rmaNumber ?? "—" },
          { header: "Customer Claim #", accessor: (c) => c.customerClaim ?? "—" },
          { header: "Part #", accessor: (c) => c.partNumber ?? "—" },
          { header: "Status", accessor: (c) => <StatusBadge value={c.status} /> },
          { header: "Created", accessor: (c) => formatDate(c.createdAt) },
        ]}
        rows={rows}
        rowKey={(c) => c.id}
        isLoading={isLoading}
        isError={isError}
        onRowClick={(c) => navigate(`/crar/${c.id}`)}
        emptyMessage="No Customer Return Analysis Reports match these filters."
      />
    </div>
  );
}
