import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { TextField, TextAreaField } from "../../components/forms/Field";

const EMPTY = {
  companyName: "",
  contactName: "",
  email: "",
  phoneNumber: "",
  poNumber: "",
  partNumber: "",
  poDate: "",
  customerClaimNumber: "",
  shortDescription: "",
  description: "",
};

/**
 * The Supplier Portal's new "RMA Request" tab — the supplier's own field
 * list exactly as specified, nothing more. Submitting triggers the real,
 * deterministic backend automation in rmaRequest.controller.ts (a real
 * numbered RMA exists the moment this call returns — see that
 * controller's own comment on why this isn't a call to the generative AI
 * assistant endpoint).
 */
export function SupplierRmaRequestForm({ onSubmitted }: { onSubmitted: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY);

  const submit = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post("/supplier-portal/rma-request", {
          ...form,
          phoneNumber: form.phoneNumber || undefined,
          poNumber: form.poNumber || undefined,
          partNumber: form.partNumber || undefined,
          poDate: form.poDate || undefined,
          customerClaimNumber: form.customerClaimNumber || undefined,
          shortDescription: form.shortDescription || undefined,
          description: form.description || undefined,
        })
      ).data as { request: { id: number }; rma: { rmaNumber: string } },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["supplier-portal/rma-request/status"] });
      toast.success(`RMA Request submitted — ${data.rma.rmaNumber} created.`);
      setForm(EMPTY);
      onSubmitted();
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't submit this RMA Request.")),
  });

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit.mutate();
      }}
    >
      <h3 className="text-sm font-medium">New RMA Request</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Company Name" required value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
        <TextField label="Contact Name" required value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
        <TextField label="Email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <TextField label="Phone Number" value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} />
        <TextField label="PO Number" value={form.poNumber} onChange={(e) => setForm({ ...form, poNumber: e.target.value })} />
        <TextField label="Part Number" value={form.partNumber} onChange={(e) => setForm({ ...form, partNumber: e.target.value })} />
        <TextField label="Date PO Was Submitted" type="date" value={form.poDate} onChange={(e) => setForm({ ...form, poDate: e.target.value })} />
        <TextField label="Customer Claim Number" value={form.customerClaimNumber} onChange={(e) => setForm({ ...form, customerClaimNumber: e.target.value })} />
      </div>
      <TextField label="Short Description" value={form.shortDescription} onChange={(e) => setForm({ ...form, shortDescription: e.target.value })} />
      <TextAreaField label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={5} />
      <button
        type="submit"
        disabled={submit.isPending || !form.companyName || !form.contactName || !form.email}
        className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submit.isPending ? "Submitting…" : "Submit"}
      </button>
    </form>
  );
}
