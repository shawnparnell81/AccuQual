import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { createResourceHooks } from "../../api/resourceHooks";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { TextAreaField, SelectField } from "../../components/forms/Field";
import { StatusBadge } from "../../components/tables/StatusBadge";
import type { Supplier8dResponse, Ncr } from "../../api/types";

const ncrHooks = createResourceHooks<Ncr>("ncr");

const D_FIELDS: { key: keyof Supplier8dResponse["data"]; label: string }[] = [
  { key: "d1_team", label: "D1 — Team" },
  { key: "d2_problem", label: "D2 — Problem Description" },
  { key: "d3_containment", label: "D3 — Containment" },
  { key: "d4_rootCause", label: "D4 — Root Cause" },
  { key: "d5_correctiveAction", label: "D5 — Corrective Action" },
  { key: "d6_validation", label: "D6 — Validation" },
  { key: "d7_prevention", label: "D7 — Prevent Recurrence" },
  { key: "d8_closure", label: "D8 — Closure" },
];

/** Full 8D responses from a supplier — data keys deliberately match the internal eight_d module's own d1_team..d8_closure naming (see supplierPortal.ts's own schema comment), a separate record optionally linked to a real internal NCR for visibility. */
export function Supplier8DForm({ supplierId, isReviewer }: { supplierId?: number; isReviewer: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: ncrs = [] } = ncrHooks.useList();
  const [linkedNcrId, setLinkedNcrId] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});

  const { data: responses = [], isLoading } = useQuery<Supplier8dResponse[]>({
    queryKey: ["supplier-portal/8d/status", supplierId ?? null],
    queryFn: async () => (await apiClient.get("/supplier-portal/8d/status", { params: supplierId ? { supplierId } : undefined })).data,
  });

  const submit = useMutation({
    mutationFn: async () => (await apiClient.post("/supplier-portal/8d/submit", { supplierId, linkedNcrId: linkedNcrId || undefined, ...form })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-portal/8d/status"] });
      setForm({});
      toast.success("8D response submitted.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't submit this 8D response.")),
  });

  const review = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: "accepted" | "rejected" }) => (await apiClient.post(`/supplier-portal/8d/${id}/review`, { status })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-portal/8d/status"] });
      toast.success("Reviewed.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't submit this review.")),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium">New 8D Response</h3>
        <SelectField label="Linked NCR (optional)" value={linkedNcrId} onChange={(e) => setLinkedNcrId(e.target.value)}>
          <option value="">None</option>
          {ncrs.map((n) => (
            <option key={n.id} value={n.id}>
              NCR #{n.id} — {n.title}
            </option>
          ))}
        </SelectField>
        {D_FIELDS.map((f) => (
          <TextAreaField key={f.key} label={f.label} value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
        ))}
        <button onClick={() => submit.mutate()} disabled={submit.isPending} className="self-start rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {submit.isPending ? "Submitting…" : "Submit 8D"}
        </button>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Submitted 8Ds</h3>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : responses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No 8D responses yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {responses.map((r) => (
              <div key={r.id} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{r.data.d2_problem || "No problem description"}</p>
                  <StatusBadge value={r.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Root cause: {r.data.d4_rootCause || "—"}</p>
                {isReviewer && (r.status === "submitted" || r.status === "under_review") && (
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => review.mutate({ id: r.id, status: "accepted" })} className="rounded-md bg-success px-3 py-1.5 text-xs font-medium text-white">
                      Accept
                    </button>
                    <button onClick={() => review.mutate({ id: r.id, status: "rejected" })} className="rounded-md border border-destructive px-3 py-1.5 text-xs text-destructive">
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
