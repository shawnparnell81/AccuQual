import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useAuthStore } from "../../store/authStore";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import type { DocumentChangeRequest, DocumentChangeItem, DocumentChangeReview, DocumentChangeStatus } from "../../api/types";

const STATUSES: DocumentChangeStatus[] = ["draft", "active", "obsolete"];

/**
 * The Document Change Request form — form 01 of the "ACCUQUAL Forms" batch
 * (see qmsFormDefinitions.ts's schema comment for why it's not on the
 * generic QMS Simple Form engine those other 22 forms share: this module
 * already existed, fully built and tested, before that batch shipped).
 * Re-skinned to the app's own theme tokens per that batch's explicit
 * "follow the color scheme of the app" instruction — it originally matched
 * the Work Order traveler's confirmed one-off dark/cyan/violet scheme,
 * which stays as its own deliberate exception; this form does not.
 */
export function DocumentChangeRequestForm({ dcr }: { dcr: DocumentChangeRequest }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const logoUrl = useAuthStore((s) => s.tenant?.branding?.logoUrl);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["document-change-requests", dcr.id] });

  const patchHeader = useMutation({
    mutationFn: async (body: Record<string, unknown>) => (await apiClient.patch(`/document-change-requests/${dcr.id}`, body)).data,
    onSuccess: invalidate,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update.")),
  });

  const addItem = useMutation({
    mutationFn: async () => (await apiClient.post(`/document-change-requests/${dcr.id}/items`, {})).data,
    onSuccess: invalidate,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't add that row.")),
  });
  const patchItem = useMutation({
    mutationFn: async ({ itemId, body }: { itemId: number; body: Record<string, unknown> }) => (await apiClient.patch(`/document-change-requests/${dcr.id}/items/${itemId}`, body)).data,
    onSuccess: invalidate,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update that row.")),
  });
  const deleteItem = useMutation({
    mutationFn: async (itemId: number) => apiClient.delete(`/document-change-requests/${dcr.id}/items/${itemId}`),
    onSuccess: invalidate,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't remove that row.")),
  });

  const addReview = useMutation({
    mutationFn: async () => (await apiClient.post(`/document-change-requests/${dcr.id}/reviews`, {})).data,
    onSuccess: invalidate,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't add that row.")),
  });
  const patchReview = useMutation({
    mutationFn: async ({ reviewId, body }: { reviewId: number; body: Record<string, unknown> }) => (await apiClient.patch(`/document-change-requests/${dcr.id}/reviews/${reviewId}`, body)).data,
    onSuccess: invalidate,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update that row.")),
  });
  const deleteReview = useMutation({
    mutationFn: async (reviewId: number) => apiClient.delete(`/document-change-requests/${dcr.id}/reviews/${reviewId}`),
    onSuccess: invalidate,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't remove that row.")),
  });

  const items = dcr.items ?? [];
  const reviews = dcr.reviews ?? [];

  return (
    <div className="rounded-lg border border-border bg-card p-6 print:border-black print:bg-white print:text-black">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4 print:border-black">
        <div className="flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" className="h-12 w-12 rounded-md border border-border object-cover print:border-black" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-md border border-border bg-muted text-xs font-semibold text-muted-foreground print:border-black">LOGO</div>
          )}
          <div>
            <h1 className="text-xl font-semibold uppercase tracking-wide">Document Change Request</h1>
            <p className="text-xs text-muted-foreground print:text-black">A change to a controlled document (document change request).</p>
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground print:text-black">
          <div>DCR NO.</div>
          <div className="text-lg font-semibold text-foreground print:text-black">#{dcr.id}</div>
        </div>
      </div>

      <h2 className="mb-2 mt-4 border-l-4 border-primary bg-muted/50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide print:border-black print:bg-transparent print:text-black">
        Document / Record Information
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <HeaderField label="Form No." value={dcr.formNo} onSave={(v) => patchHeader.mutate({ formNo: v || null })} />
        <HeaderField label="Revision" value={dcr.revision} onSave={(v) => patchHeader.mutate({ revision: v || null })} />
        <HeaderField label="Effective Date" type="date" value={dcr.effectiveDate ? dcr.effectiveDate.slice(0, 10) : ""} onSave={(v) => patchHeader.mutate({ effectiveDate: v || null })} />
        <HeaderField label="Prepared By" value={dcr.preparedBy} onSave={(v) => patchHeader.mutate({ preparedBy: v || null })} />
        <HeaderField label="Approved By" value={dcr.approvedBy} onSave={(v) => patchHeader.mutate({ approvedBy: v || null })} />
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase text-muted-foreground print:text-black">Status</span>
          <div className="flex flex-wrap gap-3 pt-1">
            {STATUSES.map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-sm capitalize">
                <input type="checkbox" checked={dcr.status === s} onChange={() => patchHeader.mutate({ status: s })} className="print:accent-black" />
                {s}
              </label>
            ))}
          </div>
        </div>
      </div>

      <h2 className="mb-2 mt-6 border-l-4 border-primary bg-muted/50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide print:border-black print:bg-transparent print:text-black">
        Change Request
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="bg-foreground text-background print:bg-black print:text-white">
              {["Change ID", "Document / Process", "Cur. Rev", "Prop. Rev", "Reason", "Requested By"].map((h) => (
                <th key={h} className="border border-border px-2 py-1.5 text-left text-xs uppercase print:border-black">
                  {h}
                </th>
              ))}
              <th className="w-8 border border-border print:hidden" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="border border-border px-2 py-2 text-center text-muted-foreground print:border-black">
                  Add the document or process you're changing. That's the row this form needs.
                </td>
              </tr>
            )}
            {items.map((item) => (
              <ChangeItemRow key={item.id} item={item} onPatch={(body) => patchItem.mutate({ itemId: item.id, body })} onDelete={() => deleteItem.mutate(item.id)} />
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={() => addItem.mutate()} disabled={addItem.isPending} className="mt-2 rounded-md border border-dashed border-primary px-3 py-1.5 text-xs text-primary hover:bg-primary/10 print:hidden">
        + Add Row
      </button>

      <h2 className="mb-2 mt-6 border-l-4 border-primary bg-muted/50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide print:border-black print:bg-transparent print:text-black">
        Review &amp; Approval
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="bg-foreground text-background print:bg-black print:text-white">
              {["Reviewer", "Comments / Impact", "Decision", "Date"].map((h) => (
                <th key={h} className="border border-border px-2 py-1.5 text-left text-xs uppercase print:border-black">
                  {h}
                </th>
              ))}
              <th className="w-8 border border-border print:hidden" />
            </tr>
          </thead>
          <tbody>
            {reviews.length === 0 && (
              <tr>
                <td colSpan={5} className="border border-border px-2 py-2 text-center text-muted-foreground print:border-black">
                  No reviews yet.
                </td>
              </tr>
            )}
            {reviews.map((review) => (
              <ReviewRow key={review.id} review={review} onPatch={(body) => patchReview.mutate({ reviewId: review.id, body })} onDelete={() => deleteReview.mutate(review.id)} />
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={() => addReview.mutate()} disabled={addReview.isPending} className="mt-2 rounded-md border border-dashed border-primary px-3 py-1.5 text-xs text-primary hover:bg-primary/10 print:hidden">
        + Add Row
      </button>

      <h2 className="mb-2 mt-6 border-l-4 border-primary bg-muted/50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide print:border-black print:bg-transparent print:text-black">
        Additional Comments / Attachments
      </h2>
      <textarea
        className="w-full rounded-md border border-border bg-background p-2 text-sm print:border-black print:bg-white print:text-black"
        rows={3}
        defaultValue={dcr.additionalComments ?? ""}
        onBlur={(e) => e.target.value !== (dcr.additionalComments ?? "") && patchHeader.mutate({ additionalComments: e.target.value || null })}
      />
    </div>
  );
}

function HeaderField({ label, value, onSave, type = "text" }: { label: string; value: string | null | undefined; onSave: (v: string) => void; type?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium uppercase text-muted-foreground print:text-black">{label}</span>
      <input
        type={type}
        defaultValue={value ?? ""}
        onBlur={(e) => e.target.value !== (value ?? "") && onSave(e.target.value)}
        className="rounded-md border border-form-field bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary print:border-black print:bg-white print:text-black"
      />
    </label>
  );
}

function ChangeItemRow({ item, onPatch, onDelete }: { item: DocumentChangeItem; onPatch: (body: Record<string, unknown>) => void; onDelete: () => void }) {
  const cell = (key: keyof DocumentChangeItem) => ({
    defaultValue: (item[key] as string) ?? "",
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => e.target.value !== ((item[key] as string) ?? "") && onPatch({ [key]: e.target.value || null }),
  });
  const inputClass = "w-full bg-transparent px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary print:text-black";
  return (
    <tr>
      <td className="border border-border p-0 print:border-black">
        <input className={inputClass} {...cell("changeId")} />
      </td>
      <td className="border border-border p-0 print:border-black">
        <input className={inputClass} {...cell("documentProcess")} />
      </td>
      <td className="border border-border p-0 print:border-black">
        <input className={inputClass} {...cell("currentRevision")} />
      </td>
      <td className="border border-border p-0 print:border-black">
        <input className={inputClass} {...cell("proposedRevision")} />
      </td>
      <td className="border border-border p-0 print:border-black">
        <input className={inputClass} {...cell("reason")} />
      </td>
      <td className="border border-border p-0 print:border-black">
        <input className={inputClass} {...cell("requestedBy")} />
      </td>
      <td className="border border-border text-center print:hidden">
        <button className="px-1 text-muted-foreground hover:text-destructive" onClick={onDelete} title="Remove row">
          ✕
        </button>
      </td>
    </tr>
  );
}

function ReviewRow({ review, onPatch, onDelete }: { review: DocumentChangeReview; onPatch: (body: Record<string, unknown>) => void; onDelete: () => void }) {
  const [decisionDraft, setDecisionDraft] = useState(review.decision ?? "");
  const inputClass = "w-full bg-transparent px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary print:text-black";

  return (
    <tr>
      <td className="border border-border p-0 print:border-black">
        <input className={inputClass} defaultValue={review.reviewer ?? ""} onBlur={(e) => e.target.value !== (review.reviewer ?? "") && onPatch({ reviewer: e.target.value || null })} />
      </td>
      <td className="border border-border p-0 print:border-black">
        <input className={inputClass} defaultValue={review.comments ?? ""} onBlur={(e) => e.target.value !== (review.comments ?? "") && onPatch({ comments: e.target.value || null })} />
      </td>
      <td className="border border-border p-0 print:border-black">
        <input className={inputClass} value={decisionDraft} onChange={(e) => setDecisionDraft(e.target.value)} onBlur={() => decisionDraft !== (review.decision ?? "") && onPatch({ decision: decisionDraft || null })} />
      </td>
      <td className="border border-border px-2 py-1.5 text-xs text-muted-foreground print:border-black print:text-black">{review.reviewDate ? new Date(review.reviewDate).toLocaleDateString() : "—"}</td>
      <td className="border border-border text-center print:hidden">
        <button className="px-1 text-muted-foreground hover:text-destructive" onClick={onDelete} title="Remove row">
          ✕
        </button>
      </td>
    </tr>
  );
}
