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
  partNumber: "",
  summary: "",
  description: "",
};

/** Supplier-only. Quality reviews the request; this does not open an NCR. */
export function SupplierNcrRequestForm() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY);

  const submit = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post("/supplier-portal/ncr-request", {
          companyName: form.companyName,
          contactName: form.contactName,
          email: form.email,
          phoneNumber: form.phoneNumber || undefined,
          partNumber: form.partNumber || undefined,
          summary: form.summary,
          description: form.description || undefined,
        })
      ).data as { request: { id: number; status: string } },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-portal/ncr-request"] });
      toast.success("NCR request sent to Quality.");
      setForm(EMPTY);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't submit this NCR request.")),
  });

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit.mutate();
      }}
    >
      <div>
        <h3 className="text-sm font-medium">New NCR request</h3>
        <p className="mt-1 text-sm text-muted-foreground">Quality reviews this request. It does not open an NCR until they decide to.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Company name" required value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
        <TextField label="Contact name" required value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
        <TextField label="Email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <TextField label="Phone" value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} />
        <TextField label="Part number" value={form.partNumber} onChange={(e) => setForm({ ...form, partNumber: e.target.value })} />
      </div>
      <TextField label="Summary" required value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
      <TextAreaField label="What happened" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={5} />
      <button
        type="submit"
        disabled={submit.isPending || !form.companyName || !form.contactName || !form.email || !form.summary}
        className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submit.isPending ? "Submitting…" : "Submit request"}
      </button>
    </form>
  );
}
