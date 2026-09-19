import { useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { useCanEditWorkflow } from "../../hooks/useWorkflowAccess";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { PrintFormButton } from "../../components/forms/PrintFormButton";
import { LinkSalesAccountButton } from "../../components/shared/LinkSalesAccountButton";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";

interface ChangeRequest {
  id: number;
  title: string;
  description: string | null;
  impactAssessment: string | null;
  status: string;
  approvedAt: string | null;
}

const changeHooks = createResourceHooks<ChangeRequest>("change");

/** Change Management detail: the quick record plus its full PCN (Product/Process Change Notice) as a fillable, exportable document. */
export function ChangeDetailPage() {
  const { id } = useParams();
  const changeId = Number(id);
  const { data: change, isLoading, isError } = changeHooks.useOne(changeId);
  const approveAction = changeHooks.useAction("approve");
  const canEdit = useCanEditWorkflow("change");

  if (isError) return <p className="text-sm text-destructive">Couldn't load this record — try refreshing the page.</p>;
  if (isLoading || !change) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Change #{change.id} — {change.title}</h1>
          <StatusBadge value={change.status} />
        </div>
        <div className="flex gap-2">
          <OpenFormButton formType="pcn" entityId={change.id} title={`PCN #${change.id} Form`} label="PCN Document" />
          <PrintFormButton formType="pcn" entityId={change.id} />
          <LinkSalesAccountButton sourceType="ChangeRequest" sourceId={change.id} defaultAccountName={change.title} />
          {canEdit && change.status !== "approved" && (
            <button onClick={() => approveAction.mutate({ id: changeId })} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              Approve
            </button>
          )}
        </div>
      </div>

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

      <AttachmentsPanel entityType="change" entityId={change.id} />
    </div>
  );
}
