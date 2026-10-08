import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { useWorkflowAction } from "../../hooks/useWorkflowAction";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { DeleteRecordButton } from "../../components/shared/DeleteRecordButton";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { RecordNumberEditor } from "../../components/forms/RecordNumberField";
import { TextField } from "../../components/forms/Field";
import { recordHeading } from "../../lib/userRecordNumber";
import { useCanEditWorkflow } from "../../hooks/useWorkflowAccess";
import { ProductionWorkOrderTraveler } from "./ProductionWorkOrderTraveler";
import type { WorkOrder, WorkOrderStatus } from "../../api/types";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";

const woHooks = createResourceHooks<WorkOrder>("work-orders");

export function WorkOrderDetailPage() {
  const { id } = useParams();
  const workOrderId = Number(id);
  const { data: record, isLoading, isError } = woHooks.useOne(workOrderId);
  const updateWo = woHooks.useUpdate();
  const canEdit = useCanEditWorkflow("work_orders");
  const [quantityCompleted, setQuantityCompleted] = useState("");

  const startAction = useWorkflowAction<{ id: number }>("work-orders", "start", { successMessage: "Work order started.", invalidateKeys: [["workflow-history", "work_orders", workOrderId]] });
  const cancelAction = useWorkflowAction<{ id: number }>("work-orders", "cancel", { successMessage: "Work order cancelled.", invalidateKeys: [["workflow-history", "work_orders", workOrderId]] });
  const completeAction = useWorkflowAction<{ id: number; quantityCompleted: number }>("work-orders", "complete", {
    successMessage: "Work order completed — inventory updated.",
    invalidateKeys: [["workflow-history", "work_orders", workOrderId], ["inventory/items"]],
  });

  if (isError) return <p className="text-sm text-destructive">Couldn't load this record — try refreshing the page.</p>;
  if (isLoading || !record) return <LoadingPlaceholder />;

  const status = record.status as WorkOrderStatus;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">{recordHeading("Work order", record.recordNumber)}</h1>
          <RecordNumberEditor label="Work Order No." value={record.recordNumber} canEdit={canEdit} onSave={(next) => updateWo.mutateAsync({ id: record.id, recordNumber: next.trim() || null })} />
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge value={record.status} />
            <span className="text-sm text-muted-foreground">
              {record.item?.sku ?? `Item #${record.itemId}`} — planned {record.quantityPlanned}, completed {record.quantityCompleted}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <DeleteRecordButton resource="work-orders" id={record.id} kind="Work order" title={record.item?.sku} number={record.recordNumber} ownerIds={[record.createdBy]} navigateTo="/work-orders" />
        </div>
      </div>

      {(status === "planned" || status === "in_progress") && (
        <div className="rounded-lg border border-border bg-card p-4 print:hidden">
          <h3 className="mb-3 text-sm font-medium">Status</h3>
          <div className="flex flex-wrap items-center gap-2">
            {status === "planned" && (
              <WorkflowActionButton label="Start" navKey="work_orders" action={startAction} onClick={() => startAction.mutate({ id: workOrderId })} variant="primary" />
            )}
            {status === "in_progress" && (
              <>
                <TextField label="" type="number" min="0" step="any" placeholder="Qty completed" value={quantityCompleted} onChange={(e) => setQuantityCompleted(e.target.value)} />
                <WorkflowActionButton
                  label="Complete"
                  navKey="work_orders"
                  action={completeAction}
                  onClick={() => completeAction.mutate({ id: workOrderId, quantityCompleted: Number(quantityCompleted) })}
                  visible={!!quantityCompleted}
                  variant="primary"
                />
              </>
            )}
            <WorkflowActionButton label="Cancel" navKey="work_orders" action={cancelAction} onClick={() => cancelAction.mutate({ id: workOrderId })} />
          </div>
        </div>
      )}

      <ProductionWorkOrderTraveler workOrder={record} />

      <div className="grid gap-4 md:grid-cols-2 print:hidden">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-medium">Linked NCR</h3>
          {record.linkedNcr ? (
            <Link to={`/ncr/${record.linkedNcr.id}`} className="text-sm text-primary hover:underline">
              NCR #{record.linkedNcr.id} — {record.linkedNcr.title}
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">Not linked.</p>
          )}
        </div>

        {record.notes && (
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-medium">Notes</h3>
            <p className="text-sm text-muted-foreground">{record.notes}</p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 print:hidden">
        <AttachmentsPanel entityType="work_orders" entityId={workOrderId} />
        <WorkflowHistoryPanel moduleName="work_orders" recordId={workOrderId} />
      </div>
    </div>
  );
}
