import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { createResourceHooks } from "../../api/resourceHooks";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { TextAreaField, SelectField } from "../../components/forms/Field";
import { StatusBadge } from "../../components/tables/StatusBadge";
import type { SupplierCorrectiveAction, Ncr, Capa } from "../../api/types";

const ncrHooks = createResourceHooks<Ncr>("ncr");
const capaHooks = createResourceHooks<Capa>("capa");

const FIELDS: { key: keyof SupplierCorrectiveAction["data"]; label: string }[] = [
  { key: "problemDescription", label: "Problem Description" },
  { key: "containment", label: "Containment" },
  { key: "rootCause", label: "Root Cause (5-Why)" },
  { key: "correctiveAction", label: "Corrective Action" },
  { key: "preventiveAction", label: "Preventive Action" },
  { key: "verification", label: "Verification" },
];

/** Supplier Corrective Action responses — optionally linked to a real internal NCR/CAPA (read-only visibility, no changes to those records themselves). Review (accept/reject) is Quality/Purchasing only. */
export function SupplierCARForm({ supplierId, isReviewer }: { supplierId?: number; isReviewer: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: ncrs = [] } = ncrHooks.useList();
  const { data: capas = [] } = capaHooks.useList();
  const [linkedNcrId, setLinkedNcrId] = useState("");
  const [linkedCapaId, setLinkedCapaId] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});

  const { data: cars = [], isLoading } = useQuery<SupplierCorrectiveAction[]>({
    queryKey: ["supplier-portal/corrective-actions/list", supplierId ?? null],
    queryFn: async () => (await apiClient.get("/supplier-portal/corrective-actions/list", { params: supplierId ? { supplierId } : undefined })).data,
  });

  const submit = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post("/supplier-portal/corrective-actions/respond", {
          supplierId,
          linkedNcrId: linkedNcrId || undefined,
          linkedCapaId: linkedCapaId || undefined,
          ...form,
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-portal/corrective-actions/list"] });
      setForm({});
      toast.success("Corrective Action response submitted.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't submit this response.")),
  });

  const review = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: "accepted" | "rejected" }) => (await apiClient.post(`/supplier-portal/corrective-actions/${id}/review`, { status })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-portal/corrective-actions/list"] });
      toast.success("Reviewed.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't submit this review.")),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium">New Corrective Action Response</h3>
        <div className="grid gap-2 sm:grid-cols-2">
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
        </div>
        {FIELDS.map((f) => (
          <TextAreaField key={f.key} label={f.label} value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
        ))}
        <button onClick={() => submit.mutate()} disabled={submit.isPending} className="self-start rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {submit.isPending ? "Submitting…" : "Submit Response"}
        </button>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Submitted Responses</h3>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : cars.length === 0 ? (
          <p className="text-sm text-muted-foreground">No responses yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {cars.map((c) => (
              <div key={c.id} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{c.data.problemDescription || "No problem description"}</p>
                  <StatusBadge value={c.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Root cause: {c.data.rootCause || "—"}</p>
                {isReviewer && (c.status === "submitted" || c.status === "under_review") && (
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => review.mutate({ id: c.id, status: "accepted" })} className="rounded-md bg-success px-3 py-1.5 text-xs font-medium text-white">
                      Accept
                    </button>
                    <button onClick={() => review.mutate({ id: c.id, status: "rejected" })} className="rounded-md border border-destructive px-3 py-1.5 text-xs text-destructive">
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
