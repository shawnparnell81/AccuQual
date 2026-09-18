import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { SalesAccount, SalesAccountStatus } from "../../api/types";
import { DataTable, type Column } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { Modal } from "../../components/modals/Modal";
import { TextField } from "../../components/forms/Field";

const salesAccountHooks = createResourceHooks<SalesAccount>("sales/accounts");

const ACCOUNT_STATUSES: SalesAccountStatus[] = ["prospect", "active", "dormant"];

const emptyForm = { customerName: "", industry: "", primaryContactName: "", primaryContactEmail: "", primaryContactPhone: "" };

/**
 * Sales & Marketing — the account list. A lightweight CRM: prospect -> active
 * -> dormant accounts, each holding its own activities/quotes/contracts —
 * see sales.ts's schema comment. Linking from other modules (NCR/PPAP/Change
 * Mgmt/Work Orders/Requisitions/PO/RMA) goes through LinkSalesAccountButton
 * on those pages, not from here.
 */
export function SalesAccountsPage() {
  const navigate = useNavigate();
  const { data: accounts = [], isLoading, isError } = salesAccountHooks.useList();
  const createAccount = salesAccountHooks.useCreate();
  const [statusFilter, setStatusFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const filtered = useMemo(() => accounts.filter((a) => !statusFilter || a.status === statusFilter), [accounts, statusFilter]);

  const columns: Column<SalesAccount>[] = [
    { header: "ID", accessor: (a) => `#${a.id}` },
    { header: "Customer", accessor: (a) => a.customerName },
    { header: "Industry", accessor: (a) => a.industry ?? "—" },
    { header: "Primary Contact", accessor: (a) => a.primaryContactName ?? "—" },
    { header: "Status", accessor: (a) => <StatusBadge value={a.status} /> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Sales Accounts</h1>
          <p className="text-sm text-muted-foreground">Accounts, activity notes, quotes, and contracts for Sales &amp; Marketing.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate("/sales/dashboard")} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Dashboard
          </button>
          <button onClick={() => setCreateOpen(true)} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
            + New Account
          </button>
        </div>
      </div>

      <div className="flex gap-3">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-border px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {ACCOUNT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <DataTable columns={columns} rows={filtered} rowKey={(a) => a.id} isLoading={isLoading} isError={isError} onRowClick={(a) => navigate(`/sales/${a.id}`)} />

      <Modal title="Create Sales Account" isOpen={createOpen} onClose={() => setCreateOpen(false)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            createAccount.mutate(
              {
                customerName: form.customerName,
                industry: form.industry || undefined,
                primaryContactName: form.primaryContactName || undefined,
                primaryContactEmail: form.primaryContactEmail || undefined,
                primaryContactPhone: form.primaryContactPhone || undefined,
              } as never,
              {
                onSuccess: (created) => {
                  setCreateOpen(false);
                  setForm(emptyForm);
                  navigate(`/sales/${created.id}`);
                },
              }
            );
          }}
        >
          <TextField label="Customer name" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} required />
          <TextField label="Industry (optional)" value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
          <TextField label="Primary contact name (optional)" value={form.primaryContactName} onChange={(e) => setForm({ ...form, primaryContactName: e.target.value })} />
          <TextField label="Primary contact email (optional)" type="email" value={form.primaryContactEmail} onChange={(e) => setForm({ ...form, primaryContactEmail: e.target.value })} />
          <TextField label="Primary contact phone (optional)" value={form.primaryContactPhone} onChange={(e) => setForm({ ...form, primaryContactPhone: e.target.value })} />
          <button type="submit" disabled={createAccount.isPending} className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {createAccount.isPending ? "Creating…" : "Create"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
