import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { useCanEditWorkflow } from "../../hooks/useWorkflowAccess";
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
  const canEdit = useCanEditWorkflow("change");
  const user = useCurrentUser();
  useEffect(() => {
    if (!change) return;
    rememberRecord({ path: `/change/${change.id}`, title: change.title, type: "Change" }, user?.id);
  }, [change, user?.id]);

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
          <DeleteRecordButton resource="change" id={change.id} kind="Change request" title={change.title} number={change.recordNumber} ownerIds={[change.requestedBy]} navigateTo="/change" />
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
          <h2 className="mb-2 text-sm font-medium">Description</h2>
          <p className="text-sm text-muted-foreground">{change.description || "Not yet documented."}</p>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium">Impact Assessment</h2>
          <p className="text-sm text-muted-foreground">{change.impactAssessment || "Not yet documented."}</p>
        </div>
      </div>
    </RecordFrame>
  );
}
