import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import { useCanEditWorkflow } from "../../hooks/useWorkflowAccess";
import { useModuleFormLock } from "../../hooks/useSavedFormMode";
import { ModuleFormLock } from "../../components/forms/SavedFormLockBar";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { useCurrentUser } from "../../hooks/useAuth";
import { rememberRecord } from "../../lib/recentRecords";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { RecordFrame } from "../../components/records/RecordFrame";
import { RecordReferences } from "../../components/records/WorkflowStepLinks";
import { DeleteRecordButton } from "../../components/shared/DeleteRecordButton";
import { RecordNumberEditor } from "../../components/forms/RecordNumberField";
import { recordHeading } from "../../lib/userRecordNumber";
import { TextAreaField } from "../../components/forms/Field";
import { SaveStatus } from "../../components/shared/SaveStatus";

interface ChangeRequest {
  id: number;
  recordNumber?: string | null;
  title: string;
  description: string | null;
  impactAssessment: string | null;
  status: string;
  approvedAt: string | null;
  requestedBy?: number | null;
}

const changeHooks = createResourceHooks<ChangeRequest>("change");

/** Change Management detail: the quick record plus its full PCN (Product/Process Change Notice) as a fillable, exportable document. */
export function ChangeDetailPage() {
  const { id } = useParams();
  const changeId = Number(id);
  const { data: change, isLoading, isError } = changeHooks.useOne(changeId);
  const updateChange = changeHooks.useUpdate();
  const approveAction = changeHooks.useAction("approve");
  const permitted = useCanEditWorkflow("change");
  const formLock = useModuleFormLock(changeId, permitted, `/change/${changeId}/begin-edit`);
  const canEdit = formLock.fieldsEditable;
  const [description, setDescription] = useState("");
  const [impact, setImpact] = useState("");
  const descriptionFocused = useRef(false);
  const impactFocused = useRef(false);
  const user = useCurrentUser();
  useEffect(() => {
    if (descriptionFocused.current) return;
    setDescription(change?.description ?? "");
  }, [change?.description]);
  useEffect(() => {
    if (impactFocused.current) return;
    setImpact(change?.impactAssessment ?? "");
  }, [change?.impactAssessment]);
  useEffect(() => {
    if (!change) return;
    rememberRecord({ path: `/change/${change.id}`, title: change.title, type: "Change" }, user?.id);
  }, [change, user?.id]);

  const descriptionDirty = change ? description !== (change.description ?? "") : false;
  const impactDirty = change ? impact !== (change.impactAssessment ?? "") : false;

  async function persistChange() {
    if (!change) return;
    const body: { description?: string | null; impactAssessment?: string | null } = {};
    if (descriptionDirty) body.description = description.trim() ? description : null;
    if (impactDirty) body.impactAssessment = impact.trim() ? impact : null;
    if (Object.keys(body).length > 0) await updateChange.mutateAsync({ id: change.id, ...body });
    else await apiClient.post(`/change/${change.id}/save`);
  }

  if (isError) return <p className="text-sm text-destructive">Couldn't load this record — try refreshing the page.</p>;
  if (isLoading || !change) return <LoadingPlaceholder />;

  return (
    <RecordFrame
      header={
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{recordHeading("Change", change.recordNumber)} — {change.title}</h1>
          <RecordNumberEditor label="Change No." value={change.recordNumber} canEdit={canEdit} onSave={(next) => updateChange.mutateAsync({ id: change.id, recordNumber: next.trim() || null })} />
          <StatusBadge value={change.status} />
        </div>
        <div className="flex gap-2">
          <ModuleFormLock mode={formLock.mode} canEdit={permitted} pending={updateChange.isPending} onEdit={() => formLock.onEdit()} onSave={() => void persistChange()} onLock={formLock.lock} />
          <SaveStatus saving={updateChange.isPending} unsaved={descriptionDirty || impactDirty} />
          <DeleteRecordButton resource="change" id={change.id} kind="Change request" title={change.title} number={change.recordNumber} ownerIds={[change.requestedBy]} navigateTo="/change" allowed={permitted} assignedOnly />
          <OpenFormButton formType="pcn" entityId={change.id} title={`${recordHeading("Change", change.recordNumber)} Form`} label="PCN Document" />
          {canEdit && change.status !== "approved" && (
            <button onClick={() => approveAction.mutate({ id: changeId })} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              Approve
            </button>
          )}
        </div>
      </div>
      }
      related={<RecordReferences modules={["change", "ecr"]} step={change.status} entityType="change" entityId={change.id} />}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <TextAreaField
            label="Description"
            value={description}
            readOnly={!canEdit}
            placeholder="Not yet documented."
            rows={5}
            onFocus={() => {
              descriptionFocused.current = true;
            }}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() => {
              descriptionFocused.current = false;
              if (description !== (change.description ?? "")) void persistChange();
            }}
          />
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <TextAreaField
            label="Impact Assessment"
            value={impact}
            readOnly={!canEdit}
            placeholder="Not yet documented."
            rows={5}
            onFocus={() => {
              impactFocused.current = true;
            }}
            onChange={(event) => setImpact(event.target.value)}
            onBlur={() => {
              impactFocused.current = false;
              if (impact !== (change.impactAssessment ?? "")) void persistChange();
            }}
          />
        </div>
      </div>
      <WorkflowHistoryPanel moduleName="change" recordId={changeId} />
    </RecordFrame>
  );
}
