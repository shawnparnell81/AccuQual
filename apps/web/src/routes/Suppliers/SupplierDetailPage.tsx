import { useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { useWorkflowAction } from "../../hooks/useWorkflowAction";
import type { Supplier } from "../../api/types";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";

const supplierHooks = createResourceHooks<Supplier>("suppliers");

/**
 * Supplier detail: the roster record plus its fillable supplier record and
 * Approved Vendor List entry, plus the 4 dedicated status-change actions
 * added in Phase 6 (approve/conditional/suspend/remove) — this page had
 * zero of them before, only the read-only status badges.
 */
export function SupplierDetailPage() {
  const { id } = useParams();
  const supplierId = Number(id);
  const { data: supplier, isLoading } = supplierHooks.useOne(supplierId);

  const approveAction = useWorkflowAction("suppliers", "approve", { successMessage: "Supplier approved." });
  const conditionalAction = useWorkflowAction("suppliers", "conditional", { successMessage: "Supplier set to conditional." });
  const suspendAction = useWorkflowAction("suppliers", "suspend", { successMessage: "Supplier suspended." });
  const removeAction = useWorkflowAction("suppliers", "remove", { successMessage: "Supplier disqualified." });

  if (isLoading || !supplier) return <p className="text-sm text-muted-foreground">Loading…</p>;

  // Disqualification is terminal on the backend (supplier.controller.ts) —
  // every other action 400s once here, so none of them are worth showing.
  const isTerminal = supplier.status === "disqualified";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{supplier.name}</h1>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge value={supplier.status} />
            <StatusBadge value={supplier.riskLevel} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <OpenFormButton formType="supplier" entityId={supplier.id} title={`Supplier #${supplier.id} Record`} label="Supplier Record" />
          <OpenFormButton
            formType="approved_vendor_list"
            entityId={supplier.id}
            title={`Supplier #${supplier.id} — Approved Vendor List`}
            label="Approved Vendor List"
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Contact: {supplier.contactEmail ?? "—"}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Status</h2>
        {isTerminal ? (
          <p className="text-sm text-muted-foreground">Disqualified — this is a terminal state; no further status changes apply.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <WorkflowActionButton
              label="Approve"
              navKey="suppliers"
              action={approveAction}
              onClick={() => approveAction.mutate({ id: supplierId })}
              visible={supplier.status !== "active"}
              variant="primary"
            />
            <WorkflowActionButton
              label="Set Conditional"
              navKey="suppliers"
              action={conditionalAction}
              onClick={() => conditionalAction.mutate({ id: supplierId })}
              visible={supplier.status !== "probation"}
            />
            <WorkflowActionButton
              label="Suspend"
              navKey="suppliers"
              action={suspendAction}
              onClick={() => suspendAction.mutate({ id: supplierId })}
              visible={supplier.status !== "suspended"}
            />
            <WorkflowActionButton label="Disqualify" navKey="suppliers" action={removeAction} onClick={() => removeAction.mutate({ id: supplierId })} />
          </div>
        )}
      </div>
    </div>
  );
}
