import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { Customer, CustomerStatus, CustomerType } from "../../api/types";
import { DataTable, type Column } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { Modal } from "../../components/modals/Modal";
import { TextField, SelectField } from "../../components/forms/Field";

const customerHooks = createResourceHooks<Customer>("customers");

const CUSTOMER_STATUSES: CustomerStatus[] = ["draft", "submitted", "under_review", "approved", "activated", "rejected"];
const CUSTOMER_TYPES: CustomerType[] = ["OEM", "Tier 1", "Tier 2", "Distributor", "Other"];

const emptyForm = { legalName: "", dbaName: "", industry: "", customerType: "", primaryContactName: "", primaryContactEmail: "" };

/**
 * Customer Onboarding — one consolidated table for the customer master
 * record AND its qualification workflow (draft -> submitted -> under_review
 * -> approved -> activated, or -> rejected), mirroring suppliers.ts's own
 * single-table pattern. See customers.ts's schema comment.
 */
export function CustomersPage() {
  const navigate = useNavigate();
  const { data: customersList = [], isLoading } = customerHooks.useList();
  const createCustomer = customerHooks.useCreate();
  const [statusFilter, setStatusFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const filtered = useMemo(() => customersList.filter((c) => !statusFilter || c.status === statusFilter), [customersList, statusFilter]);

  const columns: Column<Customer>[] = [
    { header: "ID", accessor: (c) => `#${c.id}` },
    { header: "Legal Name", accessor: (c) => c.legalName },
    { header: "Type", accessor: (c) => c.customerType ?? "—" },
    { header: "Industry", accessor: (c) => c.industry ?? "—" },
    { header: "Primary Contact", accessor: (c) => c.primaryContactName ?? "—" },
    { header: "Status", accessor: (c) => <StatusBadge value={c.status} /> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Customer Onboarding</h1>
          <p className="text-sm text-muted-foreground">Qualification, requirements, quality, logistics, and contract review for new and existing customers.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate("/customers/dashboard")} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Dashboard
          </button>
          <button onClick={() => setCreateOpen(true)} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
            + New Customer
          </button>
        </div>
      </div>

      <div className="flex gap-3">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-border px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {CUSTOMER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      <DataTable columns={columns} rows={filtered} rowKey={(c) => c.id} isLoading={isLoading} onRowClick={(c) => navigate(`/customers/${c.id}`)} />

      <Modal title="Start Customer Onboarding" isOpen={createOpen} onClose={() => setCreateOpen(false)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            createCustomer.mutate(
              {
                legalName: form.legalName,
                dbaName: form.dbaName || undefined,
                industry: form.industry || undefined,
                customerType: (form.customerType || undefined) as never,
                primaryContactName: form.primaryContactName || undefined,
                primaryContactEmail: form.primaryContactEmail || undefined,
              } as never,
              {
                onSuccess: (created) => {
                  setCreateOpen(false);
                  setForm(emptyForm);
                  navigate(`/customers/${created.id}`);
                },
              }
            );
          }}
        >
          <TextField label="Legal name" value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} required />
          <TextField label="DBA name (optional)" value={form.dbaName} onChange={(e) => setForm({ ...form, dbaName: e.target.value })} />
          <SelectField label="Customer type (optional)" value={form.customerType} onChange={(e) => setForm({ ...form, customerType: e.target.value })}>
            <option value="">Select…</option>
            {CUSTOMER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </SelectField>
          <TextField label="Industry (optional)" value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
          <TextField label="Primary contact name (optional)" value={form.primaryContactName} onChange={(e) => setForm({ ...form, primaryContactName: e.target.value })} />
          <TextField label="Primary contact email (optional)" type="email" value={form.primaryContactEmail} onChange={(e) => setForm({ ...form, primaryContactEmail: e.target.value })} />
          <button type="submit" disabled={createCustomer.isPending} className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {createCustomer.isPending ? "Creating…" : "Create"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
