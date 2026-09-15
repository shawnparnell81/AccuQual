import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessageAsync, extractErrorMessage } from "../../hooks/useWorkflowAction";
import { SelectField, TextAreaField } from "../../components/forms/Field";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { ONBOARDING_DOCUMENT_TYPES } from "../../api/types";
import type { SupplierOnboardingDocument } from "../../api/types";

/** Supplier onboarding package: W-9, NDA, Quality Manual, Process Flow, Control Plan, FMEA, Org Chart, ISO/IATF/AS9100 certs, Questionnaire, Agreement. Upload is the supplier's own self-service action (or staff on their behalf once a supplier is picked); review (approve/reject) is Quality/Purchasing only. */
export function SupplierOnboardingPanel({ supplierId, isReviewer }: { supplierId?: number; isReviewer: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documentType, setDocumentType] = useState<string>(ONBOARDING_DOCUMENT_TYPES[0]);

  const { data: docs = [], isLoading } = useQuery<SupplierOnboardingDocument[]>({
    queryKey: ["supplier-portal/onboarding/status", supplierId ?? null],
    queryFn: async () => (await apiClient.get("/supplier-portal/onboarding/status", { params: supplierId ? { supplierId } : undefined })).data,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file);
      body.append("documentType", documentType);
      if (supplierId) body.append("supplierId", String(supplierId));
      return (await apiClient.post("/supplier-portal/onboarding/upload", body)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-portal/onboarding/status"] });
      toast.success("Document uploaded.");
    },
    onError: async (err) => toast.error(await extractErrorMessageAsync(err, "Couldn't upload this document.")),
  });

  const review = useMutation({
    mutationFn: async ({ id, status, reviewNotes }: { id: number; status: "approved" | "rejected"; reviewNotes?: string }) =>
      (await apiClient.post(`/supplier-portal/onboarding/${id}/review`, { status, reviewNotes })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-portal/onboarding/status"] });
      toast.success("Reviewed.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't submit this review.")),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-2 rounded-lg border border-border bg-card p-4">
        <SelectField label="Document Type" value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
          {ONBOARDING_DOCUMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ").toUpperCase()}
            </option>
          ))}
        </SelectField>
        <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
        <button onClick={() => fileInputRef.current?.click()} disabled={upload.isPending} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {upload.isPending ? "Uploading…" : "Choose File & Upload"}
        </button>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Onboarding Status</h3>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {docs.map((d) => (
              <OnboardingRow key={d.id} doc={d} isReviewer={isReviewer} onReview={(status, reviewNotes) => review.mutate({ id: d.id, status, reviewNotes })} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function OnboardingRow({ doc, isReviewer, onReview }: { doc: SupplierOnboardingDocument; isReviewer: boolean; onReview: (status: "approved" | "rejected", notes?: string) => void }) {
  const [notes, setNotes] = useState("");
  const [reviewing, setReviewing] = useState(false);

  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{doc.documentType.replace(/_/g, " ").toUpperCase()}</p>
          <p className="text-xs text-muted-foreground">{doc.fileName}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge value={doc.status} />
          {isReviewer && doc.status === "submitted" && !reviewing && (
            <button onClick={() => setReviewing(true)} className="text-xs text-primary hover:underline">
              Review
            </button>
          )}
        </div>
      </div>
      {doc.reviewNotes && <p className="mt-1 text-xs text-muted-foreground">Reviewer note: {doc.reviewNotes}</p>}
      {reviewing && (
        <div className="mt-2 flex flex-col gap-2">
          <TextAreaField label="Review notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="flex gap-2">
            <button onClick={() => onReview("approved", notes || undefined)} className="rounded-md bg-success px-3 py-1.5 text-xs font-medium text-white">
              Approve
            </button>
            <button onClick={() => onReview("rejected", notes || undefined)} className="rounded-md border border-destructive px-3 py-1.5 text-xs text-destructive">
              Reject
            </button>
            <button onClick={() => setReviewing(false)} className="text-xs text-muted-foreground hover:underline">
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
