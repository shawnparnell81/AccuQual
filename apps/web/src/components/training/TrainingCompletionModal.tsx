import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { Modal } from "../modals/Modal";
import { TextField, TextAreaField } from "../forms/Field";
import { FileDropZone } from "../shared/FileDropZone";

/**
 * A quick, no-form way to complete an assignment and attach its certificate
 * in one step — a companion to the full "Training Record" form (see
 * FormEditor.tsx's "Complete Training" action), which some employees may
 * never open directly (e.g. an admin recording an externally-run course on
 * someone's behalf). Both paths end up calling the same
 * completeTrainingAssignment() server-side.
 */
export function TrainingCompletionModal({ assignmentId, isOpen, onClose }: { assignmentId: number; isOpen: boolean; onClose: () => void }) {
  const [trainerName, setTrainerName] = useState("");
  const [notes, setNotes] = useState("");
  const [certificate, setCertificate] = useState<File | null>(null);
  const queryClient = useQueryClient();

  const complete = useMutation({
    mutationFn: async () => {
      const result = (await apiClient.post(`/training/assignment/${assignmentId}/complete`, { trainerName: trainerName || undefined, notes: notes || undefined })).data;
      if (certificate) {
        const form = new FormData();
        form.append("file", certificate);
        await apiClient.post(`/training/assignment/${assignmentId}/certificate`, form);
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === "training-assignments" || query.queryKey[0] === "training-employee-history" });
      queryClient.invalidateQueries({ queryKey: ["workflow-history", "training", assignmentId] });
      setTrainerName("");
      setNotes("");
      setCertificate(null);
      onClose();
    },
  });

  return (
    <Modal title="Complete Training" isOpen={isOpen} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          complete.mutate();
        }}
      >
        <TextField label="Trainer Name (optional)" value={trainerName} onChange={(e) => setTrainerName(e.target.value)} />
        <TextAreaField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        <div>
          <label className="mb-1 block text-sm font-medium">Certificate (optional)</label>
          <FileDropZone className="rounded-md border border-dashed border-border p-3" accept="application/pdf" multiple={false} overlay={false} onFiles={(dropped) => setCertificate(dropped[0] ?? null)}>
          <p className="mb-2 text-xs text-muted-foreground">{certificate ? `Selected: ${certificate.name}` : "Drag a PDF here, or choose one:"}</p>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setCertificate(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-sm"
          />
          </FileDropZone>
        </div>
        <button type="submit" disabled={complete.isPending} className="w-fit self-end rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
          {complete.isPending ? "Saving…" : "Mark Complete"}
        </button>
      </form>
    </Modal>
  );
}
