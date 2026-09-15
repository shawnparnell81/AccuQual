import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { useWorkflowAction } from "../../hooks/useWorkflowAction";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { TextField } from "../../components/forms/Field";
import { LinkSalesAccountButton } from "../../components/shared/LinkSalesAccountButton";
import { CreateCustomerButton } from "../../components/shared/CreateCustomerButton";
import { ProductionWorkOrderTraveler } from "./ProductionWorkOrderTraveler";
import type { WorkOrder, WorkOrderStatus } from "../../api/types";

const woHooks = createResourceHooks<WorkOrder>("work-orders");

export function WorkOrderDetailPage() {
  const { id } = useParams();
  const workOrderId = Number(id);
  const { data: record, isLoading } = woHooks.useOne(workOrderId);
  const [quantityCompleted, setQuantityCompleted] = useState("");

  const startAction = useWorkflowAction<{ id: number }>("work-orders", "start", { successMessage: "Work order started.", invalidateKeys: [["workflow-history", "work_orders", workOrderId]] });
  const cancelAction = useWorkflowAction<{ id: number }>("work-orders", "cancel", { successMessage: "Work order cancelled.", invalidateKeys: [["workflow-history", "work_orders", workOrderId]] });
  const completeAction = useWorkflowAction<{ id: number; quantityCompleted: number }>("work-orders", "complete", {
    successMessage: "Work order completed — inventory updated.",
    invalidateKeys: [["workflow-history", "work_orders", workOrderId], ["inventory/items"]],
  });

  if (isLoading || !record) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const status = record.status as WorkOrderStatus;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">Work Order #{record.id}</h1>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge value={record.status} />
            <span className="text-sm text-muted-foreground">
              {record.item?.sku ?? `Item #${record.itemId}`} — planned {record.quantityPlanned}, completed {record.quantityCompleted}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Print
          </button>
          <LinkSalesAccountButton sourceType="WorkOrder" sourceId={record.id} defaultAccountName={`Work Order #${record.id}`} />
          <CreateCustomerButton sourceType="WorkOrder" sourceId={record.id} defaultLegalName={`Work Order #${record.id}`} />
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
