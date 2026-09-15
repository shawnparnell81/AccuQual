import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage, extractErrorMessageAsync } from "../../hooks/useWorkflowAction";
import { AdminOnlyGuard } from "../../components/shared/AdminOnlyGuard";
import { StatusBadge } from "../../components/tables/StatusBadge";
import type { FormTemplateStatus } from "../../api/types";

// The 9 form types this page is explicitly meant to manage (see the Tenant
// Template Upload UI review) — a subset of forms.validation.ts's full
// FORM_TYPES list, matching what was actually asked for. Any of the other
// ~26 real types can be reached the same way via the backend if needed
// later; this page just doesn't list every one of them.
const MANAGED_TYPES: { type: string; label: string }[] = [
  { type: "ncr", label: "NCR" },
  { type: "capa", label: "CAPA" },
  { type: "eight_d", label: "8D" },
  { type: "audit_plan", label: "Audit Plan" },
  { type: "supplier", label: "Supplier" },
  { type: "calibration", label: "Calibration" },
  { type: "complaint", label: "Complaint" },
  { type: "change", label: "Change Form" },
  { type: "discrepancy_inspection", label: "Discrepancy Inspection" },
];

function useTemplates() {
  return useQuery<FormTemplateStatus[]>({ queryKey: ["forms/templates"], queryFn: async () => (await apiClient.get("/forms/templates")).data });
}

function TemplateRow({ type, label, status }: { type: string; label: string; status?: FormTemplateStatus }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return (await apiClient.post(`/forms/${type}/template`, body, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["forms/templates"] });
      toast.success(`${label} template uploaded.`);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't upload template.")),
  });

  const remove = useMutation({
    mutationFn: async () => apiClient.delete(`/forms/${type}/template`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["forms/templates"] });
      toast.success(`Reverted ${label} to the default template.`);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't remove template.")),
  });

  // A plain <a href> can't carry the Authorization header this endpoint
  // requires — same real pattern as DocumentHistoryPanel/TrainingHistoryPanel's
  // certificate preview: fetch as a blob through the authenticated client,
  // then open that.
  async function preview() {
    try {
      const res = await apiClient.get(`/forms/${type}/template/file`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(await extractErrorMessageAsync(err, "Couldn't load template preview."));
    }
  }

  return (
    <tr className="border-t border-border">
      <td className="py-2 font-medium">{label}</td>
      <td className="py-2">
        {!status?.hasTemplate ? (
          <span className="text-muted-foreground">—</span>
        ) : status.isDefault ? (
          <StatusBadge value="draft" label="AccuQual Default" />
        ) : (
          <StatusBadge value="active" label="Custom" />
        )}
      </td>
      <td className="py-2 text-right">
        <div className="flex justify-end gap-2">
          {status?.hasTemplate && (
            <button onClick={preview} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
              Preview
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
              e.target.value = "";
            }}
          />
          <button onClick={() => fileInput.current?.click()} disabled={upload.isPending} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">
            {upload.isPending ? "Uploading…" : status?.isDefault === false ? "Replace" : "Upload"}
          </button>
          {status?.isDefault === false && (
            <button onClick={() => remove.mutate()} disabled={remove.isPending} className="rounded-md border border-border px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50">
              Delete
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function TemplatesTable() {
  const { data: templates = [], isLoading } = useTemplates();
  const byType = new Map(templates.map((t) => [t.formType, t]));

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Form Type</th>
            <th className="px-4 py-2 font-medium">Template</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {MANAGED_TYPES.map(({ type, label }) => (
            <TemplateRow key={type} type={type} label={label} status={byType.get(type)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminTenantTemplatesPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Tenant Templates</h1>
      <AdminOnlyGuard>
        <TemplatesTable />
      </AdminOnlyGuard>
    </div>
  );
}
