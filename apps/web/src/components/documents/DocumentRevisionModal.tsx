import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { Modal } from "../modals/Modal";
import { TextAreaField } from "../forms/Field";
import { useToast } from "../shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

/**
 * Revision workflow: uploading a new file bumps currentVersion and sets
 * status back to "in_review" (POST /documents/:id/version/upload — see
 * documents.controller.ts's createDocumentVersionRow) — the previous
 * revision isn't deleted, just no longer current; it stays visible in
 * DocumentHistoryPanel. Re-approving (DocumentApprovalModal) is what moves
 * it to Released again.
 */
export function DocumentRevisionModal({ documentId, isOpen, onClose }: { documentId: number; isOpen: boolean; onClose: () => void }) {
  const [changeNotes, setChangeNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const revise = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a PDF file first");
      const form = new FormData();
      form.append("file", file);
      if (changeNotes) form.append("changeNotes", changeNotes);
      return (await apiClient.post(`/documents/${documentId}/version/upload`, form)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["document", documentId, "history"] });
      queryClient.invalidateQueries({ queryKey: ["workflow-history", "documents", documentId] });
      queryClient.invalidateQueries({ queryKey: ["document-folders"] });
      setChangeNotes("");
      setFile(null);
      toast.success("Revision uploaded — back to In Review.");
      onClose();
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't upload this revision.")),
  });

  return (
    <Modal title="Revise Document" isOpen={isOpen} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          revise.mutate();
        }}
      >
        <p className="text-sm text-muted-foreground">Uploads a new revision and sends it back to Draft / In Review for approval.</p>
        <div>
          <label className="mb-1 block text-sm font-medium">New Revision PDF</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            required
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-sm"
          />
        </div>
        <TextAreaField label="What changed in this revision?" value={changeNotes} onChange={(e) => setChangeNotes(e.target.value)} rows={3} />
        {revise.isError && <p className="text-sm text-destructive">{extractErrorMessage(revise.error, "Couldn't upload this revision.")}</p>}
        <button type="submit" disabled={revise.isPending || !file} className="w-fit self-end rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
          {revise.isPending ? "Uploading…" : "Upload Revision"}
        </button>
      </form>
    </Modal>
  );
}
