import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { readNcrStepDocuments, type LinkedDocumentRef } from "../../lib/stepDocuments";
import { LinkedDocumentsEditor } from "./LinkedDocumentsEditor";
import { LinkedDocumentList, useWorkflowStepLinks } from "./WorkflowStepLinks";

/** Documents linked on the NCR's current step, plus any the published process already names. */
export function NcrStepDocuments({
  ncrId,
  step,
  stepLabel,
  processData,
  canEdit,
}: {
  ncrId: number;
  step: string;
  stepLabel: string;
  processData: unknown;
  canEdit: boolean;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const saved = readNcrStepDocuments(processData, step);
  const fromProcess = useWorkflowStepLinks(["ncr"], stepLabel);
  const save = useMutation({
    mutationFn: async (documents: LinkedDocumentRef[]) =>
      (await apiClient.put(`/ncr/${ncrId}/step-documents`, { step, documents })).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ncr", ncrId] });
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't link that document.")),
  });

  return (
    <section className="rounded-lg border border-border bg-card p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Linked docs</h2>
      <p className="mb-2 text-xs text-muted-foreground">{stepLabel}</p>
      <LinkedDocumentsEditor documents={saved} canEdit={canEdit} busy={save.isPending} onChange={(next) => save.mutate(next)} />
      {fromProcess.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <p className="mb-1 text-xs text-muted-foreground">From the process</p>
          <LinkedDocumentList documents={fromProcess} empty="" />
        </div>
      )}
    </section>
  );
}
