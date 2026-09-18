import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useWorkflowAccessLevel } from "../../hooks/useWorkflowAccess";
import { DataTable } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { SelectField, TextField } from "../../components/forms/Field";
import type { RmaLogRecord, RmaLogStatus } from "../../api/types";

const rmaLogHooks = createResourceHooks<RmaLogRecord>("rma-log");
const STATUSES: RmaLogStatus[] = ["open", "received", "under_review", "dispositioned", "closed"];

/**
 * RMA Log register — the real, manually-maintained customer-return log
 * (not the automated Supplier RMA Request event trail at
 * /rma-activity-log). "Add New" is RBAC-controlled: only visible with
 * rma_log.write (live, DB-driven — see useWorkflowAccessLevel), matching
 * the brief's own explicit button-behavior spec. Clicking it POSTs an
 * empty body — the backend auto-generates rmaNumber and defaults
 * dateIssued to today, then the user lands straight on the detail page to
 * fill in everything else.
 */
export function RmaLogListPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const canWrite = useWorkflowAccessLevel("rma_log") === "edit";
  const [status, setStatus] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [q, setQ] = useState("");

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (status) p.status = status;
    if (partNumber) p.partNumber = partNumber;
    if (customerName) p.customerName = customerName;
    if (q) p.q = q;
    return p;
  }, [status, partNumber, customerName, q]);

  const { data: rows = [], isLoading, isError } = rmaLogHooks.useList(params);
  const createRecord = rmaLogHooks.useCreate();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">RMA Log</h1>
        {canWrite && (
          <button
            onClick={() =>
              createRecord.mutate(
                {} as never,
                {
                  onSuccess: (created) => navigate(`/rma-log/${created.id}`),
                  onError: (err) => toast.error(extractErrorMessage(err, "Couldn't create a new RMA Log entry.")),
                }
              )
            }
            disabled={createRecord.isPending}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createRecord.isPending ? "Creating…" : "+ Add New"}
          </button>
        )}
      </div>

      <div className="grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-4">
        <TextField label="Search RMA #" value={q} onChange={(e) => setQ(e.target.value)} />
        <TextField label="Part Number" value={partNumber} onChange={(e) => setPartNumber(e.target.value)} />
        <TextField label="Customer Name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </SelectField>
      </div>

      <DataTable<RmaLogRecord>
        columns={[
          { header: "RMA #", accessor: (r) => r.rmaNumber },
          { header: "Date Issued", accessor: (r) => new Date(r.dateIssued).toLocaleDateString() },
          { header: "Customer", accessor: (r) => r.customerName ?? "—" },
          { header: "Part #", accessor: (r) => r.partNumber ?? "—" },
          { header: "Part Description", accessor: (r) => r.partDescription ?? "—" },
          { header: "Qty Returned", accessor: (r) => r.quantityReturned ?? "—" },
          { header: "Status", accessor: (r) => <StatusBadge value={r.status} /> },
          { header: "Disposition", accessor: (r) => r.dispositionAction ?? "—" },
          { header: "Date Closed", accessor: (r) => (r.dateClosed ? new Date(r.dateClosed).toLocaleDateString() : "—") },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        isError={isError}
        onRowClick={(r) => navigate(`/rma-log/${r.id}`)}
        emptyMessage="No RMA Log entries match these filters."
      />
    </div>
  );
}
