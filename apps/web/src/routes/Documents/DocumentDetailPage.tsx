import { useState } from "react";
import { useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { AccuQualDocument } from "../../api/types";
import { DocumentHistoryPanel } from "../../components/documents/DocumentHistoryPanel";
import { DocumentApprovalModal } from "../../components/documents/DocumentApprovalModal";
import { DocumentRevisionModal } from "../../components/documents/DocumentRevisionModal";
import { DocumentRetentionPanel } from "../../components/documents/DocumentRetentionPanel";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { AiFieldAssistant } from "../../components/shared/AiFieldAssistant";
import { useSetAssistantContext } from "../../hooks/useAssistantContext";

const documentHooks = createResourceHooks<AccuQualDocument>("documents");

// "Released" is the ISO document-control term for "approved" — kept as a
// label override on the shared StatusBadge rather than its own color map.
const STATUS_LABELS: Record<AccuQualDocument["status"], string> = {
  draft: "Draft",
  in_review: "In Review",
  approved: "Released",
  obsolete: "Obsolete",
};

/**
 * One controlled document: status, the four workflow actions (approve /
 * revise), expiration + retention rules, and its full version + audit
 * history. Approval workflow rule (see documents.controller.ts): only
 * "approved" documents are meant to be live in a module — Draft/In Review
 * stay effectively unreleased, Obsolete stays visible here for history only.
 */
export function DocumentDetailPage() {
  const { id } = useParams();
  const documentId = Number(id);
  const { data: doc, isLoading } = documentHooks.useOne(documentId);
  useSetAssistantContext("sop_generator", documentId, doc ? doc.title : `Document #${documentId}`);
  const [approveOpen, setApproveOpen] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);

  if (isLoading || !doc) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{doc.title}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span>{doc.category ?? "Uncategorized"}</span>
            <span>— Rev {doc.currentVersion}</span>
            <StatusBadge value={doc.status} label={STATUS_LABELS[doc.status]} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <AiFieldAssistant
            module="sop_generator"
            recordId={documentId}
            triggerLabel="Generate SOP"
            buildInitialPrompt={() =>
              `Draft SOP content for "${doc.title}"${doc.category ? ` (category: ${doc.category})` : ""}. Structure it with Purpose, Scope,` +
              " Responsibilities, Procedure (numbered steps), and Records sections. Suggest steps based on the process this document" +
              " covers, and propose relevant controls and checks. This is a draft for the document owner to refine and use when authoring" +
              " the real controlled document — AccuQual's Document Control is file-based, so this text has to be copied into whatever" +
              " file gets uploaded as the next revision, not inserted directly."
            }
          />
          <button onClick={() => setReviseOpen(true)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Revise
          </button>
          <button
            onClick={() => setApproveOpen(true)}
            disabled={doc.status === "approved" || doc.status === "obsolete"}
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-40"
          >
            Approve
          </button>
        </div>
      </div>

      <DocumentRetentionPanel document={doc} />
      <DocumentHistoryPanel documentId={documentId} />

      <DocumentApprovalModal documentId={documentId} isOpen={approveOpen} onClose={() => setApproveOpen(false)} />
      <DocumentRevisionModal documentId={documentId} isOpen={reviseOpen} onClose={() => setReviseOpen(false)} />
    </div>
  );
}
