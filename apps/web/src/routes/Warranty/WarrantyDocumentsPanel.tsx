import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessageAsync } from "../../hooks/useWorkflowAction";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { SelectField } from "../../components/forms/Field";
import { FileDropZone } from "../../components/shared/FileDropZone";

/**
 * A category-aware upload (failure photo vs. general document — indexed
 * onto the claim's own failureImages/documents jsonb fields, see
 * warranty.controller.ts's uploadWarrantyDocumentHandler) sitting on top of
 * the same real, generic AttachmentsPanel every other record's evidence
 * uses (both write into the one shared `attachments` table tagged
 * entityType:"warranty_claim") — not a second, separate file listing.
 */
export function WarrantyDocumentsPanel({ claimId }: { claimId: number }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<"document" | "failure_image">("document");

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file);
      body.append("category", category);
      return (await apiClient.post(`/warranty/claims/${claimId}/upload`, body)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attachments", "warranty_claim", claimId] });
      queryClient.invalidateQueries({ queryKey: ["warranty/claims", claimId] });
      toast.success("File uploaded.");
    },
    onError: async (err) => toast.error(await extractErrorMessageAsync(err, "Couldn't upload this file.")),
  });

  return (
    <FileDropZone className="flex flex-col gap-3" disabled={upload.isPending} label="Drop to add to this claim" onFiles={(dropped) => dropped.forEach((file) => upload.mutate(file))}>
      <div className="flex items-end gap-2">
        <SelectField label="Category" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
          <option value="document">Document (repair report, proof of purchase, …)</option>
          <option value="failure_image">Failure photo</option>
        </SelectField>
        <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
        <button onClick={() => fileInputRef.current?.click()} disabled={upload.isPending} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60">
          {upload.isPending ? "Uploading…" : "Choose File & Upload"}
        </button>
      </div>
      <AttachmentsPanel entityType="warranty_claim" entityId={claimId} title="Claim Documents & Photos" />
    </FileDropZone>
  );
}
