import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessageAsync, extractErrorMessage } from "../../hooks/useWorkflowAction";
import { TextField, TextAreaField, SelectField } from "../../components/forms/Field";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { PPAP_DOCUMENT_TYPES } from "../../api/types";
import type { SupplierPpapSubmission } from "../../api/types";
import { FileDropZone } from "../../components/shared/FileDropZone";

const LEVELS = [1, 2, 3, 4, 5];

/** PPAP submissions, Levels 1-5 — PSW/DFMEA/PFMEA/Control Plan/Process Flow/Dimensional & Material Results/Initial Process Studies/Appearance Approval Report/Sample Parts/Packaging Specs, each a separate named document attached to one submission. */
export function PPAPSubmissionPanel({ supplierId, isReviewer }: { supplierId?: number; isReviewer: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [level, setLevel] = useState(3);
  const [partNumber, setPartNumber] = useState("");
  const [description, setDescription] = useState("");

  const { data: submissions = [], isLoading } = useQuery<SupplierPpapSubmission[]>({
    queryKey: ["supplier-portal/ppap/status", supplierId ?? null],
    queryFn: async () => (await apiClient.get("/supplier-portal/ppap/status", { params: supplierId ? { supplierId } : undefined })).data,
  });

  const submit = useMutation({
    mutationFn: async () => (await apiClient.post("/supplier-portal/ppap/submit", { level, partNumber: partNumber || undefined, description: description || undefined, supplierId })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-portal/ppap/status"] });
      setPartNumber("");
      setDescription("");
      toast.success("PPAP submission created.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't create this PPAP submission.")),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 rounded-lg border border-border bg-card p-4 sm:grid-cols-4">
        <SelectField label="Level" value={level} onChange={(e) => setLevel(Number(e.target.value))}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              Level {l}
            </option>
          ))}
        </SelectField>
        <TextField label="Part Number" value={partNumber} onChange={(e) => setPartNumber(e.target.value)} />
        <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="flex items-end">
          <button onClick={() => submit.mutate()} disabled={submit.isPending} className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {submit.isPending ? "Submitting…" : "New Submission"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : submissions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No PPAP submissions yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {submissions.map((s) => (
            <PpapCard key={s.id} submission={s} isReviewer={isReviewer} />
          ))}
        </div>
      )}
    </div>
  );
}

function PpapCard({ submission, isReviewer }: { submission: SupplierPpapSubmission; isReviewer: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documentType, setDocumentType] = useState<string>(PPAP_DOCUMENT_TYPES[0]);
  const [reviewing, setReviewing] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");

  const attach = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file);
      body.append("documentType", documentType);
      return (await apiClient.post(`/supplier-portal/ppap/${submission.id}/documents`, body)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-portal/ppap/status"] });
      toast.success("Document attached.");
    },
    onError: async (err) => toast.error(await extractErrorMessageAsync(err, "Couldn't attach this document.")),
  });

  const review = useMutation({
    mutationFn: async (status: "approved" | "rejected" | "under_review") =>
      (await apiClient.post(`/supplier-portal/ppap/${submission.id}/review`, { status, reviewNotes: reviewNotes || undefined })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-portal/ppap/status"] });
      setReviewing(false);
      toast.success("Reviewed.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't submit this review.")),
  });

  const attachedTypes = Object.keys(submission.documents ?? {});

  return (
    <FileDropZone className="rounded-lg border border-border bg-card p-4" multiple={false} disabled={attach.isPending} label={`Drop to attach as ${documentType.replace(/_/g, " ")}`} onFiles={(dropped) => attach.mutate(dropped[0]!)}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">
            Level {submission.level} — {submission.partNumber ?? "No part number"}
          </p>
          <p className="text-xs text-muted-foreground">{submission.description ?? "No description"}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge value={submission.status} />
          {/* Kept up here next to the status badge, not at the far right of
              the bottom "Attach document" row — that corner sits under the
              fixed AI assistant button on most viewports, which visually
              covers a bottom-right ml-auto control (found via a live
              browser check). */}
          {isReviewer && submission.status !== "approved" && submission.status !== "rejected" && (
            <button onClick={() => setReviewing(!reviewing)} className="text-xs text-primary hover:underline">
              Review
            </button>
          )}
        </div>
      </div>
      {submission.reviewNotes && <p className="mt-1 text-xs text-muted-foreground">Reviewer note: {submission.reviewNotes}</p>}

      <div className="mt-2 flex flex-wrap gap-1">
        {PPAP_DOCUMENT_TYPES.map((t) => (
          <span key={t} className={`rounded px-1.5 py-0.5 text-xs ${attachedTypes.includes(t) ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
            {t.replace(/_/g, " ")}
          </span>
        ))}
      </div>

      <div className="mt-3 flex items-end gap-2 border-t border-border pt-3">
        <SelectField label="Attach document" value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
          {PPAP_DOCUMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </SelectField>
        <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && attach.mutate(e.target.files[0])} />
        <button onClick={() => fileInputRef.current?.click()} disabled={attach.isPending} className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted disabled:opacity-60">
          {attach.isPending ? "Uploading…" : "Upload"}
        </button>
      </div>

      {reviewing && (
        <div className="mt-2 flex flex-col gap-2">
          <TextAreaField label="Review notes" value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} />
          <div className="flex gap-2">
            <button onClick={() => review.mutate("approved")} className="rounded-md bg-success px-3 py-1.5 text-xs font-medium text-white">
              Approve
            </button>
            <button onClick={() => review.mutate("under_review")} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">
              Mark Under Review
            </button>
            <button onClick={() => review.mutate("rejected")} className="rounded-md border border-destructive px-3 py-1.5 text-xs text-destructive">
              Reject
            </button>
          </div>
        </div>
      )}
    </FileDropZone>
  );
}
