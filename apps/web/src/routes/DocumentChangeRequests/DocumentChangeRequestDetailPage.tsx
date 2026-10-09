import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { DeleteRecordButton } from "../../components/shared/DeleteRecordButton";
import { DocumentChangeRequestForm } from "./DocumentChangeRequestForm";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { useModuleFormLock } from "../../hooks/useSavedFormMode";
import { ModuleFormLock } from "../../components/forms/SavedFormLockBar";
import { SavedFormFields } from "../../components/forms/SavedFormFields";
import { SaveStatus } from "../../components/shared/SaveStatus";
import type { DocumentChangeRequest } from "../../api/types";

const dcrHooks = createResourceHooks<DocumentChangeRequest>("document-change-requests");

export function DocumentChangeRequestDetailPage() {
  const { id } = useParams();
  const dcrId = Number(id);
  const navigate = useNavigate();
  const { data: dcr, isLoading, isError } = dcrHooks.useOne(dcrId);
  const { effective } = useEffectivePermissions();
  const permitted = effective?.documents === "edit";
  const formLock = useModuleFormLock(dcrId, permitted, `/document-change-requests/${dcrId}/begin-edit`);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const wasSaving = useRef(false);
  useEffect(() => {
    if (wasSaving.current && !saving) setSaved(true);
    wasSaving.current = saving;
  }, [saving]);

  if (isError) return <p className="text-sm text-destructive">Couldn't load this doc change. Refresh the page and try again.</p>;
  if (isLoading || !dcr) return <p className="text-sm text-muted-foreground">Loading this doc change…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between print:hidden">
        <button onClick={() => navigate("/document-change-requests")} className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to list
        </button>
        <div className="flex gap-2">
          <ModuleFormLock
            mode={formLock.mode}
            canEdit={permitted}
            pending={saving}
            onEdit={() => formLock.onEdit()}
            onSave={() => {
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
              setSaved(true);
            }}
            onLock={formLock.lock}
          />
          {(saved || saving) && <SaveStatus saving={saving} unsaved={false} />}
          <DeleteRecordButton resource="document-change-requests" id={dcrId} kind="Document change request" title={dcr.documentProcessName || dcr.currentDocNumber} number={dcr.formNo} ownerIds={[dcr.createdBy]} navigateTo="/document-change-requests" allowed={permitted} assignedOnly />
        </div>
      </div>

      <SavedFormFields locked={!formLock.fieldsEditable}>
        <DocumentChangeRequestForm dcr={dcr} onSaving={setSaving} />
      </SavedFormFields>

      <div className="flex flex-col gap-4 print:hidden">
        <AttachmentsPanel entityType="document_change_requests" entityId={dcrId} />
        <WorkflowHistoryPanel moduleName="document_change_requests" recordId={dcrId} />
      </div>
    </div>
  );
}
