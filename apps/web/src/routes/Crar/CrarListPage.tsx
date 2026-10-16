import { useServerTable } from "../../api/usePagedList";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { DataTable } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { NumberedCreateButton } from "../../components/forms/RecordNumberField";
import { SelectField, TextField } from "../../components/forms/Field";
import type { CrarClaim, CrarStatus } from "../../api/types";
import { formatDate } from "../../lib/dates";

const crarHooks = createResourceHooks<CrarClaim>("crar");
const STATUSES: CrarStatus[] = ["new", "quality_review", "warranty_review", "completed"];

/** Customer Return Analysis Report roster — Quality creates new ones; Customer Service/Engineering/Purchasing get read (or link-only) access — see departmentAccess.ts's PERMISSION_MATRIX.crar. */
export function CrarListPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (status) p.status = status;
    if (q) p.q = q;
    return p;
  }, [status, q]);
  const { rows: rows, isLoading, isError, server } = useServerTable<CrarClaim>("/crar", { root: "crar", params: params, });
  const createCrar = crarHooks.useCreate();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Customer Return Analysis Reports</h1>
        <NumberedCreateButton
          label="+ New CRAR"
          numberLabel="Customer Claim #"
          dialogTitle="New customer return analysis"
          pending={createCrar.isPending}
          onCreate={async (recordNumber) => {
            const created = await createCrar.mutateAsync({ customerClaim: recordNumber.trim() || null } as never);
            navigate(`/crar/${created.id}`);
          }}
        />
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
server={server}
        columns={[
          { header: "Customer", sortKey: "customerName", accessor: (c) => c.customerName ?? "—" },
          { header: "RMA #", sortKey: "rmaNumber", accessor: (c) => c.rmaNumber ?? "—" },
          { header: "Customer Claim #", sortKey: "customerClaim", accessor: (c) => c.customerClaim ?? "—" },
          { header: "Part #", sortKey: "partNumber", accessor: (c) => c.partNumber ?? "—" },
          { header: "Status", sortKey: "status", accessor: (c) => <StatusBadge value={c.status} /> },
          { header: "Created", sortKey: "createdAt", accessor: (c) => formatDate(c.createdAt) },
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
