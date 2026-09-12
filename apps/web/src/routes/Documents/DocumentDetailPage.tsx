import { useState } from "react";
import { useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { AccuQualDocument } from "../../api/types";
import { DocumentHistoryPanel } from "../../components/documents/DocumentHistoryPanel";
import { DocumentApprovalModal } from "../../components/documents/DocumentApprovalModal";
import { DocumentRevisionModal } from "../../components/documents/DocumentRevisionModal";
import { DocumentRetentionPanel } from "../../components/documents/DocumentRetentionPanel";

const documentHooks = createResourceHooks<AccuQualDocument>("documents");

const STATUS_LABELS: Record<AccuQualDocument["status"], string> = {
  draft: "Draft",
  in_review: "In Review",
  approved: "Released",
  obsolete: "Obsolete",
};
const STATUS_COLORS: Record<AccuQualDocument["status"], { bg: string; fg: string }> = {
  draft: { bg: "#EAEAE6", fg: "#66655D" },
  in_review: { bg: "#FEF3C7", fg: "#92400E" },
  approved: { bg: "#DCFCE7", fg: "#166534" },
  obsolete: { bg: "#F3F4F6", fg: "#6B7280" },
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
  const [approveOpen, setApproveOpen] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);

  if (isLoading || !doc) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const statusColors = STATUS_COLORS[doc.status];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{doc.title}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span>{doc.category ?? "Uncategorized"}</span>
            <span>— Rev {doc.currentVersion}</span>
            <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: statusColors.bg, color: statusColors.fg }}>
              {STATUS_LABELS[doc.status]}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
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
