import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { createResourceHooks } from "../../api/resourceHooks";
import { useWorkflowAction, extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useCanEditWorkflow } from "../../hooks/useWorkflowAccess";
import { useToast } from "../../components/shared/ToastProvider";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { TextAreaField } from "../../components/forms/Field";
import { LinkSalesAccountButton } from "../../components/shared/LinkSalesAccountButton";
import { CreateCustomerButton } from "../../components/shared/CreateCustomerButton";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import type { ErpPurchaseRequisition } from "../../api/types";

const requisitionHooks = createResourceHooks<ErpPurchaseRequisition>("erp/requisitions");

export function ErpRequisitionDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const requisitionId = Number(id);
  const { data: record, isLoading, isError } = requisitionHooks.useOne(requisitionId);
  const updateReq = requisitionHooks.useUpdate();
  const canApprove = useCanEditWorkflow("erp"); // purchasing/admin — matches erp.controller.ts's assertDepartment(["purchasing"]) on approve/reject/convert

  const [justificationDraft, setJustificationDraft] = useState("");
  const [editingJustification, setEditingJustification] = useState(false);

  const submitAction = useWorkflowAction<{ id: number }>("erp/requisitions", "submit", { successMessage: "Requisition submitted for approval." });
  const approveAction = useWorkflowAction<{ id: number }>("erp/requisitions", "approve", { successMessage: "Requisition approved." });
  const rejectAction = useWorkflowAction<{ id: number }>("erp/requisitions", "reject", { successMessage: "Requisition rejected." });
  const convertAction = useMutation({
    mutationFn: async () => (await apiClient.post(`/erp/requisitions/${requisitionId}/convert-to-po`)).data as { requisition: ErpPurchaseRequisition; purchaseOrder: { id: number } },
    onSuccess: (res) => {
      toast.success(`Converted to Purchase Order #${res.purchaseOrder.id}.`);
      navigate(`/erp/${res.purchaseOrder.id}`);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't convert to a Purchase Order.")),
  });

  const aiJustify = useMutation({
    mutationFn: async () => (await apiClient.post<{ justification: string }>(`/erp/requisitions/${requisitionId}/ai-justify`)).data,
    onSuccess: (res) => {
      setJustificationDraft(res.justification);
      setEditingJustification(true);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't draft a justification.")),
  });

  if (isError) return <p className="text-sm text-destructive">Couldn't load this record — try refreshing the page.</p>;
  if (isLoading || !record) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">Purchase Requisition #{record.id}</h1>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge value={record.status} />
            <span className="text-sm text-muted-foreground">
              {record.item?.sku ?? `Item #${record.itemId}`} — qty {record.quantity}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => window.print()} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Print
          </button>
          <LinkSalesAccountButton sourceType="Requisition" sourceId={record.id} defaultAccountName={`Requisition #${record.id}`} />
          <CreateCustomerButton sourceType="Requisition" sourceId={record.id} defaultLegalName={`Requisition #${record.id}`} />
        </div>
      </div>

      <div className="hidden print:block">
        <h1 className="text-2xl font-semibold">Purchase Requisition #{record.id}</h1>
        <p className="text-sm text-muted-foreground">Status: {record.status.replace(/_/g, " ")} — {record.item?.sku ?? `Item #${record.itemId}`}, qty {record.quantity}</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 print:hidden">
        <h3 className="mb-3 text-sm font-medium">Status</h3>
        <div className="flex flex-wrap gap-2">
          {record.status === "draft" && <WorkflowActionButton label="Submit for Approval" navKey="purchase_requisitions" action={submitAction} onClick={() => submitAction.mutate({ id: requisitionId })} variant="primary" />}
          {record.status === "pending_approval" && (
            <>
              <WorkflowActionButton label="Approve" navKey="erp" action={approveAction} onClick={() => approveAction.mutate({ id: requisitionId })} visible={canApprove} variant="primary" />
              <WorkflowActionButton label="Reject" navKey="erp" action={rejectAction} onClick={() => rejectAction.mutate({ id: requisitionId })} visible={canApprove} />
            </>
          )}
          {record.status === "approved" && (
            <WorkflowActionButton
              label={convertAction.isPending ? "Converting…" : "Convert to Purchase Order"}
              navKey="erp"
              action={convertAction}
              onClick={() => convertAction.mutate()}
              visible={canApprove}
              variant="primary"
            />
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-medium">Item</h3>
          <p className="text-sm">{record.item?.sku ?? `Item #${record.itemId}`}</p>
          <p className="text-sm text-muted-foreground">{record.item?.description ?? "No description"}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-medium">Supplier</h3>
          {record.supplier ? (
            <>
              <p className="text-sm font-medium">{record.supplier.name}</p>
              <StatusBadge value={record.supplier.status} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No supplier set.</p>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Justification</h3>
          {record.status === "draft" && (
            <button onClick={() => aiJustify.mutate()} disabled={aiJustify.isPending} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50">
              {aiJustify.isPending ? "Drafting…" : "Draft with AI"}
            </button>
          )}
        </div>
        {editingJustification ? (
          <div className="mt-2 flex flex-col gap-2">
            <TextAreaField label="" value={justificationDraft} onChange={(e) => setJustificationDraft(e.target.value)} />
            <div className="flex gap-2">
              <button
                onClick={() =>
                  updateReq.mutate({ id: requisitionId, justification: justificationDraft } as never, {
                    onSuccess: () => {
                      toast.success("Justification saved.");
                      setEditingJustification(false);
                    },
                    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save justification.")),
                  })
                }
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
              >
                Save
              </button>
              <button onClick={() => setEditingJustification(false)} className="text-xs text-muted-foreground hover:underline">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => {
              if (record.status !== "draft") return;
              setJustificationDraft(record.justification ?? "");
              setEditingJustification(true);
            }}
            className={`mt-2 text-left text-sm text-muted-foreground ${record.status === "draft" ? "hover:underline" : "cursor-default"}`}
          >
            {record.justification || (record.status === "draft" ? "Add justification…" : "No justification provided.")}
          </button>
        )}
      </div>

      <div className="print:hidden">
        <AttachmentsPanel entityType="erp_requisition" entityId={requisitionId} />
      </div>
    </div>
  );
}
