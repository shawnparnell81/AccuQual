import { useNavigate, useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { DeleteRecordButton } from "../../components/shared/DeleteRecordButton";
import { DocumentChangeRequestForm } from "./DocumentChangeRequestForm";
import type { DocumentChangeRequest } from "../../api/types";

const dcrHooks = createResourceHooks<DocumentChangeRequest>("document-change-requests");

export function DocumentChangeRequestDetailPage() {
  const { id } = useParams();
  const dcrId = Number(id);
  const navigate = useNavigate();
  const { data: dcr, isLoading, isError } = dcrHooks.useOne(dcrId);

  if (isError) return <p className="text-sm text-destructive">Couldn't load this doc change. Refresh the page and try again.</p>;
  if (isLoading || !dcr) return <p className="text-sm text-muted-foreground">Loading this doc change…</p>;

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
          <DeleteRecordButton resource="document-change-requests" id={dcrId} kind="Document change request" title={dcr.documentProcessName || dcr.currentDocNumber || dcr.formNo} ownerIds={[dcr.createdBy]} navigateTo="/document-change-requests" />
        </div>
      </div>

      <DocumentChangeRequestForm dcr={dcr} />

      <div className="flex flex-col gap-4 print:hidden">
        <AttachmentsPanel entityType="document_change_requests" entityId={dcrId} />
        <WorkflowHistoryPanel moduleName="document_change_requests" recordId={dcrId} />
      </div>
    </div>
  );
}
