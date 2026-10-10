import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useFaiLookups, useFaiQueue, useFaiRecords, useInvalidateFai, type FaiRecordDetail, type FaiRecordSummary } from "../../api/fai";
import { DataTable, type Column } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { peopleForAssignment, personLabel } from "../../lib/opsLanguage";
import { RecordNumberField } from "../../components/forms/RecordNumberField";
import { showRecordNumber } from "../../lib/userRecordNumber";
import { CopyFromPrevious } from "../../components/records/CopyFromPrevious";

export function FaiQueuePage() {
  const navigate = useNavigate();
  const queue = useFaiQueue();
  const records = useFaiRecords();
  const lookups = useFaiLookups();
  const invalidate = useInvalidateFai();
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [partName, setPartName] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [number, setNumber] = useState("");
  const [error, setError] = useState<string | null>(null);

  const plan = lookups.data?.plans.find((row) => String(row.id) === planId);
  const openFai = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post<FaiRecordDetail>("/fai/records", {
          planId: Number(planId),
          partNumber: plan?.scope === "family" ? partNumber : plan?.partNumber,
          partName: partName || plan?.partName || null,
          supplierId: Number(plan?.supplierId ?? supplierId),
          assignedTo: assignedTo ? Number(assignedTo) : null,
          number: number.trim() || null,
        })
      ).data,
    onSuccess: async (created) => {
      await invalidate();
      navigate(`/fai/records/${created.id}`);
    },
    onError: (err) => setError(extractErrorMessage(err, "The first article could not be opened.")),
  });

  const openColumns: Column<NonNullable<typeof queue.data>["open"][number]>[] = [
    { header: "FAI No.", accessor: (row) => showRecordNumber(row.number) },
    { header: "Part", accessor: (row) => row.partNumber },
    { header: "Supplier", accessor: (row) => row.supplierName },
    { header: "Status", accessor: (row) => <StatusBadge value={row.status} /> },
    { header: "Assigned", accessor: (row) => personLabel(lookups.data?.people, row.assignedTo) },
  ];
  const sourceColumns: Column<NonNullable<typeof queue.data>["dueSoon"][number]>[] = [
    { header: "Part", accessor: (row) => row.partNumber },
    { header: "Supplier", accessor: (row) => row.supplierName },
    { header: "Status", accessor: (row) => <StatusBadge value={row.status} /> },
    { header: "Last pass", accessor: (row) => row.lastPassDate ?? "—" },
    { header: "Next due", accessor: (row) => row.nextDueDate ?? "—" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">First Article</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Open first articles, inspections due within 30 days, overdue inspections, and sources that were not approved. This does not receive material and does not hold inventory or purchase orders.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/fai/csa" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            CSA first article
          </Link>
          <Link to="/fai/fuel-pump" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Fuel pump FAI
          </Link>
          <Link to="/fai/plans/new" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            New inspection plan
          </Link>
          <button type="button" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground" onClick={() => setOpen((value) => !value)}>
            Open an FAI
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <Link to="/fai/sources" className="text-primary hover:underline">Source list</Link>
        <Link to="/fai/pull" className="text-primary hover:underline">Yearly pull</Link>
        <Link to="/iso-forms/frm-fai-001" className="text-primary hover:underline">First Article blank</Link>
      </div>

      {open && (
        <form
          className="grid gap-3 rounded-md border border-border bg-card p-3 md:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            openFai.mutate();
          }}
        >
          <RecordNumberField label="FAI No." value={number} error={error} onChange={(value) => { setError(null); setNumber(value); }} />
          <label className="flex flex-col gap-1 text-xs">
            Inspection plan
            <select className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={planId} onChange={(event) => setPlanId(event.target.value)} required>
              <option value="">Select</option>
              {lookups.data?.plans.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name} · rev {row.currentRevision}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Part number
            <input className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={plan?.scope === "part" ? plan.partNumber ?? "" : partNumber} disabled={plan?.scope === "part"} onChange={(event) => setPartNumber(event.target.value)} required={plan?.scope === "family"} />
          </label>
          <CopyFromPrevious
            partNumber={plan?.scope === "part" ? plan.partNumber ?? "" : partNumber}
            previousPath="/fai/records/previous"
            copyPath="/fai/records/copy"
            onCopied={(created) => navigate(`/fai/records/${created.id}`)}
          />
          <label className="flex flex-col gap-1 text-xs">
            Part name
            <input className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={partName} onChange={(event) => setPartName(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Supplier
            <select className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={plan?.supplierId ? String(plan.supplierId) : supplierId} disabled={plan?.supplierId != null} onChange={(event) => setSupplierId(event.target.value)} required>
              <option value="">Select</option>
              {lookups.data?.suppliers.map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Assign result entry
            <select className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}>
              <option value="">Unassigned</option>
              {peopleForAssignment(lookups.data?.people ?? []).map((row) => (
                <option key={row.id} value={row.id}>{row.name?.trim() || row.email}</option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button type="submit" disabled={openFai.isPending || !planId} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {openFai.isPending ? "Opening…" : "Open first article"}
            </button>
          </div>
          {error && <p className="text-sm text-destructive md:col-span-3">{error}</p>}
        </form>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Open first articles</h2>
        <DataTable columns={openColumns} rows={queue.data?.open ?? []} rowKey={(row) => row.id} isLoading={queue.isLoading} isError={queue.isError} emptyMessage="No open first articles." onRowClick={(row) => navigate(`/fai/records/${row.id}`)} listChrome={false} />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Due within 30 days</h2>
        <DataTable columns={sourceColumns} rows={queue.data?.dueSoon ?? []} rowKey={(row) => row.id} isLoading={queue.isLoading} isError={queue.isError} emptyMessage="Nothing is due in the next 30 days." onRowClick={() => navigate("/fai/sources")} listChrome={false} />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Overdue</h2>
        <DataTable columns={sourceColumns} rows={queue.data?.overdue ?? []} rowKey={(row) => row.id} isLoading={queue.isLoading} isError={queue.isError} emptyMessage="Nothing is overdue." onRowClick={() => navigate("/fai/sources")} listChrome={false} />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Not approved</h2>
        <DataTable columns={sourceColumns} rows={queue.data?.failed ?? []} rowKey={(row) => row.id} isLoading={queue.isLoading} isError={queue.isError} emptyMessage="No source is marked not approved." onRowClick={() => navigate("/fai/sources")} listChrome={false} />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Recent first articles</h2>
        <DataTable
          columns={[
            { header: "FAI No.", accessor: (row: FaiRecordSummary) => showRecordNumber(row.number) },
            { header: "Part", accessor: (row: FaiRecordSummary) => row.partNumber },
            { header: "Supplier", accessor: (row: FaiRecordSummary) => row.supplierName },
            { header: "Status", accessor: (row: FaiRecordSummary) => <StatusBadge value={row.status} /> },
          ]}
          rows={records.data ?? []}
          rowKey={(row) => row.id}
          isLoading={records.isLoading}
          isError={records.isError}
          emptyMessage="No first articles yet."
          onRowClick={(row) => navigate(`/fai/records/${row.id}`)}
          listChrome={false}
        />
      </section>
    </div>
  );
}
