import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { useCurrentUser } from "../../hooks/useAuth";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { Modal } from "../../components/modals/Modal";
import { FeasibilityReviewForm } from "./FeasibilityReviewForm";
import type { FeasibilityReview } from "../../api/types";

const feasibilityHooks = createResourceHooks<FeasibilityReview>("feasibility");

export function FeasibilityDetailPage() {
  const { id } = useParams();
  const reviewId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();
  const user = useCurrentUser();
  const { data: review, isLoading, isError } = feasibilityHooks.useOne(reviewId);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const isAdmin = user?.roleName === "admin";
  const canEditRecord = isAdmin || user?.department === "engineering";

  const finalize = feasibilityHooks.useAction("finalize");
  const deleteReview = feasibilityHooks.useDelete();

  if (isError) return <p className="text-sm text-destructive">Couldn't load this record — try refreshing the page.</p>;
  if (isLoading || !review) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <button onClick={() => navigate("/feasibility")} className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to list
        </button>
        <div className="flex items-center gap-2">
          <StatusBadge value={review.status} />
          <button onClick={() => window.print()} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Print
          </button>
          {canEditRecord && review.status === "draft" && (
            <button
              onClick={() =>
                finalize.mutate(
                  { id: reviewId },
                  { onSuccess: () => toast.success("Feasibility Review finalized."), onError: (err) => toast.error(extractErrorMessage(err, "Couldn't finalize this review.")) }
                )
              }
              disabled={finalize.isPending}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {finalize.isPending ? "Finalizing…" : "Finalize"}
            </button>
          )}
          {canEditRecord && (
            <button onClick={() => setDeleteOpen(true)} className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/10">
              Delete
            </button>
          )}
        </div>
      </div>

      <FeasibilityReviewForm review={review} />

      <div className="flex flex-col gap-4 print:hidden">
        <AttachmentsPanel entityType="feasibility" entityId={reviewId} />
        <WorkflowHistoryPanel moduleName="feasibility" recordId={reviewId} />
      </div>

      <Modal title="Delete Feasibility Review" isOpen={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <div className="flex flex-col gap-4">
          <p className="text-sm">Permanently delete this Feasibility Review? This cannot be undone.</p>
          <div className="flex gap-2">
            <button
              onClick={() =>
                deleteReview.mutate(reviewId, {
                  onSuccess: () => {
                    toast.success("Feasibility Review deleted.");
                    navigate("/feasibility");
                  },
                  onError: (err) => toast.error(extractErrorMessage(err, "Couldn't delete this record.")),
                })
              }
              disabled={deleteReview.isPending}
              className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-60"
            >
              {deleteReview.isPending ? "Deleting…" : "Delete permanently"}
            </button>
            <button onClick={() => setDeleteOpen(false)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
