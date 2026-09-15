import { useState } from "react";
import { createResourceHooks } from "../../api/resourceHooks";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { Modal } from "../../components/modals/Modal";
import { TextField, SelectField, TextAreaField } from "../../components/forms/Field";
import type { WarrantyClaim, Customer, InventoryItem, Supplier } from "../../api/types";

const claimHooks = createResourceHooks<WarrantyClaim>("warranty/claims");
const customerHooks = createResourceHooks<Customer>("customers");
const productHooks = createResourceHooks<InventoryItem>("inventory/items");
const supplierHooks = createResourceHooks<Supplier>("suppliers");

/**
 * Customer Service/Quality intake — real dynamic customer/product/supplier
 * dropdowns, same reasoning NewRmaModal (RmaListPage.tsx) gives for not
 * using the generic JSON-schema quick-create form here.
 */
export function WarrantyClaimCreateForm({ isOpen, onClose, onCreated }: { isOpen: boolean; onClose: () => void; onCreated: (claim: WarrantyClaim) => void }) {
  const toast = useToast();
  const { data: customers = [] } = customerHooks.useList();
  const { data: products = [] } = productHooks.useList();
  const { data: suppliers = [] } = supplierHooks.useList();
  const createClaim = claimHooks.useCreate();

  const [form, setForm] = useState({
    customerId: "",
    productId: "",
    serialNumber: "",
    purchaseDate: "",
    failureDate: "",
    failureDescription: "",
    warrantyCostEstimate: "",
    supplierId: "",
  });

  const reset = () =>
    setForm({ customerId: "", productId: "", serialNumber: "", purchaseDate: "", failureDate: "", failureDescription: "", warrantyCostEstimate: "", supplierId: "" });

  return (
    <Modal title="New Warranty Claim" isOpen={isOpen} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          createClaim.mutate(
            {
              customerId: form.customerId ? Number(form.customerId) : undefined,
              productId: form.productId ? Number(form.productId) : undefined,
              serialNumber: form.serialNumber || undefined,
              purchaseDate: form.purchaseDate || undefined,
              failureDate: form.failureDate || undefined,
              failureDescription: form.failureDescription || undefined,
              warrantyCostEstimate: form.warrantyCostEstimate ? Number(form.warrantyCostEstimate) : undefined,
              supplierId: form.supplierId ? Number(form.supplierId) : undefined,
            } as never,
            {
              onSuccess: (created) => {
                toast.success(`${created.claimNumber} created.`);
                reset();
                onClose();
                onCreated(created);
              },
              onError: (err) => toast.error(extractErrorMessage(err, "Couldn't create the warranty claim.")),
            }
          );
        }}
      >
        <SelectField label="Customer" value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
          <option value="">Select a customer…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.legalName}
            </option>
          ))}
        </SelectField>
        <SelectField label="Product" value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
          <option value="">Select a product…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.sku}
            </option>
          ))}
        </SelectField>
        <TextField label="Serial Number" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Purchase Date" type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} />
          <TextField label="Failure Date" type="date" value={form.failureDate} onChange={(e) => setForm({ ...form, failureDate: e.target.value })} />
        </div>
        <TextAreaField label="Failure Description" value={form.failureDescription} onChange={(e) => setForm({ ...form, failureDescription: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Estimated Cost" type="number" min="0" step="0.01" value={form.warrantyCostEstimate} onChange={(e) => setForm({ ...form, warrantyCostEstimate: e.target.value })} />
          <SelectField label="Supplier (optional)" value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
            <option value="">None</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
        </div>
        <button type="submit" disabled={createClaim.isPending} className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
          {createClaim.isPending ? "Creating…" : "Create Claim"}
        </button>
      </form>
    </Modal>
  );
}
