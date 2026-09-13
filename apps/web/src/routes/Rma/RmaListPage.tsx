import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { DataTable } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { Modal } from "../../components/modals/Modal";
import { TextField, SelectField, TextAreaField } from "../../components/forms/Field";
import type { Rma, RmaStatus, RmaReasonCode, Supplier, Ncr, Capa } from "../../api/types";

const rmaHooks = createResourceHooks<Rma>("rma");
const supplierHooks = createResourceHooks<Supplier>("suppliers");
const ncrHooks = createResourceHooks<Ncr>("ncr");
const capaHooks = createResourceHooks<Capa>("capa");

const STATUSES: RmaStatus[] = ["draft", "submitted_to_supplier", "approved_by_supplier", "in_transit", "received_by_supplier", "closed", "cancelled"];
const REASON_CODES: RmaReasonCode[] = ["defective", "wrong_item", "over_shipment", "under_shipment", "quality_issue", "other"];

/**
 * Header-only create — line items are added on the detail page afterward
 * (the spec's own endpoint split: POST /rma then POST /rma/:id/items), same
 * two-step flow Supplier's scorecards use. Needs real dynamic supplier/NCR/
 * CAPA dropdowns, which the generic quick-create modal (GenericCreateForm)
 * can't do — same reasoning ErpNewPurchaseOrderPage's own comment gives for
 * not using the JSON-schema form engine here either.
 */
function NewRmaModal({ isOpen, onClose, onCreated }: { isOpen: boolean; onClose: () => void; onCreated: (rma: Rma) => void }) {
  const toast = useToast();
  const { data: suppliers = [] } = supplierHooks.useList();
  const { data: ncrs = [] } = ncrHooks.useList();
  const { data: capas = [] } = capaHooks.useList();
  const createRma = rmaHooks.useCreate();

  const [supplierId, setSupplierId] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [linkedNcrId, setLinkedNcrId] = useState("");
  const [linkedCapaId, setLinkedCapaId] = useState("");
  const [notes, setNotes] = useState("");

  const reset = () => {
    setSupplierId("");
    setReasonCode("");
    setLinkedNcrId("");
    setLinkedCapaId("");
    setNotes("");
  };

  return (
    <Modal title="New RMA" isOpen={isOpen} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          createRma.mutate(
            {
              supplierId: Number(supplierId),
              reasonCode: reasonCode || undefined,
              linkedNcrId: linkedNcrId ? Number(linkedNcrId) : undefined,
              linkedCapaId: linkedCapaId ? Number(linkedCapaId) : undefined,
              notes: notes || undefined,
            } as never,
            {
              onSuccess: (created) => {
                toast.success(`${created.rmaNumber} created.`);
                reset();
                onClose();
                onCreated(created);
              },
              onError: (err) => toast.error(extractErrorMessage(err, "Couldn't create RMA.")),
            }
          );
        }}
      >
        <SelectField label="Supplier" required value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">Select a supplier…</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Reason Code" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
          <option value="">None</option>
          {REASON_CODES.map((r) => (
            <option key={r} value={r}>
              {r.replace(/_/g, " ")}
            </option>
          ))}
        </SelectField>
        <SelectField label="Linked NCR (optional)" value={linkedNcrId} onChange={(e) => setLinkedNcrId(e.target.value)}>
          <option value="">None</option>
          {ncrs.map((n) => (
            <option key={n.id} value={n.id}>
              NCR #{n.id} — {n.title}
            </option>
          ))}
        </SelectField>
        <SelectField label="Linked CAPA (optional)" value={linkedCapaId} onChange={(e) => setLinkedCapaId(e.target.value)}>
          <option value="">None</option>
          {capas.map((c) => (
            <option key={c.id} value={c.id}>
              CAPA #{c.id}
            </option>
          ))}
        </SelectField>
        <TextAreaField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button
          type="submit"
          disabled={!supplierId || createRma.isPending}
          className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {createRma.isPending ? "Creating…" : "Create RMA"}
        </button>
      </form>
    </Modal>
  );
}

/** RMA/RGA roster — filters (status/supplier/reason/date) run server-side via GET /rma's query params; search-by-number is the one filter without its own field (folded into the same "q" param the backend already supports). */
export function RmaListPage() {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [q, setQ] = useState("");

  const { data: suppliers = [] } = supplierHooks.useList();
  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (status) p.status = status;
    if (supplierId) p.supplierId = supplierId;
    if (reasonCode) p.reasonCode = reasonCode;
    if (dateFrom) p.dateFrom = dateFrom;
    if (dateTo) p.dateTo = dateTo;
    if (q) p.q = q;
    return p;
  }, [status, supplierId, reasonCode, dateFrom, dateTo, q]);
  const { data: rows = [], isLoading } = rmaHooks.useList(params);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">RMA / RGA</h1>
        <button onClick={() => setCreateOpen(true)} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
          + New RMA
        </button>
      </div>

      <div className="grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-3 lg:grid-cols-6">
        <TextField label="Search RMA #" placeholder="RMA-000123" value={q} onChange={(e) => setQ(e.target.value)} />
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </SelectField>
        <SelectField label="Supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">All</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Reason" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
          <option value="">All</option>
          {REASON_CODES.map((r) => (
            <option key={r} value={r}>
              {r.replace(/_/g, " ")}
            </option>
          ))}
        </SelectField>
        <TextField label="From" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <TextField label="To" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
      </div>

      <DataTable<Rma>
        columns={[
          { header: "RMA #", accessor: (r) => r.rmaNumber },
          { header: "Supplier", accessor: (r) => r.supplierName ?? "—" },
          { header: "Status", accessor: (r) => <StatusBadge value={r.status} /> },
          { header: "Reason", accessor: (r) => (r.reasonCode ? r.reasonCode.replace(/_/g, " ") : "—") },
          { header: "Created", accessor: (r) => new Date(r.createdAt).toLocaleDateString() },
          { header: "Notes", accessor: (r) => r.notes ?? "—" },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        onRowClick={(r) => navigate(`/rma/${r.id}`)}
        emptyMessage="No RMAs match these filters."
      />

      <NewRmaModal isOpen={createOpen} onClose={() => setCreateOpen(false)} onCreated={(created) => navigate(`/rma/${created.id}`)} />
    </div>
  );
}
