import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import type { WorkflowDefinition } from "../../api/types";
import { linkedDocumentsForStep, mergeLinkedDocuments, type LinkedDocumentRef } from "../../lib/stepDocuments";
import { AttachmentsPanel } from "../shared/AttachmentsPanel";

/** Published-document links stored on the workflow step that matches this record. */
export function useWorkflowStepLinks(modules: string[], step: string) {
  const query = useQuery({
    queryKey: ["workflow", "step-links", modules.join(","), step],
    queryFn: async () => (await apiClient.get<WorkflowDefinition[]>("/workflow")).data,
    enabled: modules.length > 0 && step.trim().length > 0,
    retry: false,
    staleTime: 60_000,
  });
  const wanted = new Set(modules);
  const nodes = (query.data ?? [])
    .filter((row) => row.isActive === "true" && row.module != null && wanted.has(row.module))
    .flatMap((row) => row.definition?.nodes ?? []);
  return linkedDocumentsForStep(nodes, step);
}

export function LinkedDocumentList({ documents, empty }: { documents: LinkedDocumentRef[]; empty: string }) {
  if (documents.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {documents.map((doc) => (
        <li key={doc.id}>
          <Link to={`/documents/${doc.id}`} className="truncate text-primary hover:underline">
            {doc.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function mergeStepLinks(...groups: LinkedDocumentRef[][]): LinkedDocumentRef[] {
  return mergeLinkedDocuments(...groups);
}

/** References strip for a record that keeps its form body as-is. */
export function RecordReferences({
  modules,
  step,
  entityType,
  entityId,
  attachments = true,
}: {
  modules: string[];
  step: string;
  entityType: string;
  entityId: number;
  /** Controlled lists are not an attachment parent. Leave this off so the page does not ask for files. */
  attachments?: boolean;
}) {
  const links = useWorkflowStepLinks(modules, step);
  return (
    <>
      <section className="rounded-lg border border-border bg-card p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Linked docs</h2>
        <LinkedDocumentList documents={links} empty="No published document is linked on this step." />
      </section>
      {attachments ? <AttachmentsPanel entityType={entityType} entityId={entityId} title="Attachments" /> : null}
    </>
  );
}
