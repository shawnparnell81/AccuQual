import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { Modal } from "../modals/Modal";
import { TextAreaField } from "../forms/Field";
import { useToast } from "../shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

/**
 * Approval workflow rule: only "approved" (Released) documents are meant to
 * surface in modules — see FolderExplorerPage's badge on a linked leaf. This
 * modal is the one place status flips draft/in_review -> approved
 * (POST /documents/:id/approve, which also records the audit trail entry —
 * see documents.controller.ts).
 */
export function DocumentApprovalModal({ documentId, isOpen, onClose }: { documentId: number; isOpen: boolean; onClose: () => void }) {
  const [approvalNotes, setApprovalNotes] = useState("");
  const queryClient = useQueryClient();
  const toast = useToast();

  const approve = useMutation({
    mutationFn: async () => (await apiClient.post(`/documents/${documentId}/approve`, { approvalNotes: approvalNotes || undefined })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["document", documentId, "history"] });
      queryClient.invalidateQueries({ queryKey: ["audit-trail", "Document", documentId] });
      queryClient.invalidateQueries({ queryKey: ["document-folders"] }); // a linked leaf's badge depends on this document's status
      setApprovalNotes("");
      toast.success("Document released.");
      onClose();
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't approve this document.")),
  });

  return (
    <Modal title="Approve Document" isOpen={isOpen} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          approve.mutate();
        }}
      >
        <p className="text-sm text-muted-foreground">
          Approving sets this document's current revision to <span className="font-medium">Released</span> and records who approved it.
        </p>
        <TextAreaField label="Approval Notes (optional)" value={approvalNotes} onChange={(e) => setApprovalNotes(e.target.value)} rows={3} />
        <button type="submit" disabled={approve.isPending} className="w-fit self-end rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
          {approve.isPending ? "Approving…" : "Approve"}
        </button>
      </form>
    </Modal>
  );
}
