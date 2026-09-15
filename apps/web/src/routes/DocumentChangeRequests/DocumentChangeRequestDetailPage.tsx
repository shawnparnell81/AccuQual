import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { Modal } from "../../components/modals/Modal";
import { DocumentChangeRequestForm } from "./DocumentChangeRequestForm";
import type { DocumentChangeRequest } from "../../api/types";

const dcrHooks = createResourceHooks<DocumentChangeRequest>("document-change-requests");

export function DocumentChangeRequestDetailPage() {
  const { id } = useParams();
  const dcrId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();
  const { data: dcr, isLoading } = dcrHooks.useOne(dcrId);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const deleteDcr = useMutation({
    mutationFn: async () => apiClient.delete(`/document-change-requests/${dcrId}`),
    onSuccess: () => {
      toast.success("Document Change Request deleted.");
      navigate("/document-change-requests");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't delete this record.")),
  });

  if (isLoading || !dcr) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between print:hidden">
        <button onClick={() => navigate("/document-change-requests")} className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to list
        </button>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Print
          </button>
          <button onClick={() => setDeleteOpen(true)} className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/10">
            Delete
          </button>
        </div>
      </div>

      <DocumentChangeRequestForm dcr={dcr} />

      <div className="flex flex-col gap-4 print:hidden">
        <AttachmentsPanel entityType="document_change_requests" entityId={dcrId} />
        <WorkflowHistoryPanel moduleName="document_change_requests" recordId={dcrId} />
      </div>

      <Modal title="Delete Document Change Request" isOpen={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <div className="flex flex-col gap-4">
          <p className="text-sm">Permanently delete this Document Change Request and its rows? This cannot be undone.</p>
          <div className="flex gap-2">
            <button
              onClick={() => deleteDcr.mutate()}
              disabled={deleteDcr.isPending}
              className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-60"
            >
              {deleteDcr.isPending ? "Deleting…" : "Delete permanently"}
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
