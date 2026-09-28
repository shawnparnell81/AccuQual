import { isFullAccessRole } from "../../lib/fullAccess";
import { useNavigate, useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { useCurrentUser } from "../../hooks/useAuth";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { DeleteRecordButton } from "../../components/shared/DeleteRecordButton";
import { FeasibilityReviewForm } from "./FeasibilityReviewForm";
import { PictureRecordProvider } from "../../components/forms/pictureRecord";
import type { FeasibilityReview } from "../../api/types";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";

const feasibilityHooks = createResourceHooks<FeasibilityReview>("feasibility");

export function FeasibilityDetailPage() {
  const { id } = useParams();
  const reviewId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();
  const user = useCurrentUser();
  const { data: review, isLoading, isError } = feasibilityHooks.useOne(reviewId);

  const isAdmin = isFullAccessRole(user?.roleName);
  const canEditRecord = isAdmin || user?.department === "engineering";

  const finalize = feasibilityHooks.useAction("finalize");

  if (isError) return <p className="text-sm text-destructive">Couldn't load this record — try refreshing the page.</p>;
  if (isLoading || !review) return <LoadingPlaceholder />;

  return (
    <PictureRecordProvider entityType="feasibility" entityId={reviewId}>
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
          <DeleteRecordButton resource="feasibility" id={reviewId} kind="Feasibility review" title={review.partProjectName} ownerIds={[review.createdBy, review.ownerId]} navigateTo="/feasibility" />
        </div>
      </div>

      <FeasibilityReviewForm review={review} />

      <div className="flex flex-col gap-4 print:hidden">
        <AttachmentsPanel entityType="feasibility" entityId={reviewId} />
        <WorkflowHistoryPanel moduleName="feasibility" recordId={reviewId} />
      </div>
    </div>
    </PictureRecordProvider>
  );
}
