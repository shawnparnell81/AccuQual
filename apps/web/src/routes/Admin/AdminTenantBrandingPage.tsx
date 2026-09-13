import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { AdminOnlyGuard } from "../../components/shared/AdminOnlyGuard";
import { TextField, TextAreaField } from "../../components/forms/Field";
import type { TenantBranding } from "../../api/types";

function useBranding() {
  return useQuery<TenantBranding>({ queryKey: ["tenant/branding"], queryFn: async () => (await apiClient.get("/tenant/branding")).data });
}

/**
 * Not the JSON-schema form engine — this is a live-bound settings form
 * prefilled from the tenant's actual current branding, the same kind of
 * page every other module's real settings editing already is (Security &
 * Roles, item/supplier linking), not a fixed-schema printable document.
 */
function BrandingForm() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: branding, isLoading } = useBranding();
  const [form, setForm] = useState<TenantBranding>({ logoUrl: "", primaryColor: "#3b82f6", pdfHeader: "", pdfFooter: "" });

  useEffect(() => {
    if (branding) setForm({ logoUrl: branding.logoUrl ?? "", primaryColor: branding.primaryColor ?? "#3b82f6", pdfHeader: branding.pdfHeader ?? "", pdfFooter: branding.pdfFooter ?? "" });
  }, [branding]);

  const save = useMutation({
    mutationFn: async (body: TenantBranding) => (await apiClient.patch("/tenant/branding", body)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant/branding"] });
      toast.success("Branding saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save branding.")),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(form);
      }}
    >
      <TextField label="Logo URL" placeholder="https://…" value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} />

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Primary Color</span>
        <div className="flex items-center gap-2">
          <input type="color" value={form.primaryColor || "#3b82f6"} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} className="h-9 w-14 rounded border border-border bg-background" />
          <TextField label="" value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} />
        </div>
      </label>

      <TextAreaField label="PDF Header" value={form.pdfHeader} onChange={(e) => setForm({ ...form, pdfHeader: e.target.value })} />
      <TextAreaField label="PDF Footer" value={form.pdfFooter} onChange={(e) => setForm({ ...form, pdfFooter: e.target.value })} />

      <button type="submit" disabled={save.isPending} className="w-fit rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
        {save.isPending ? "Saving…" : "Save Branding"}
      </button>
    </form>
  );
}

export function AdminTenantBrandingPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Tenant Branding</h1>
      <AdminOnlyGuard>
        <BrandingForm />
      </AdminOnlyGuard>
    </div>
  );
}
