import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { SelectField, TextAreaField, TextField } from "../../components/forms/Field";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { PrintFormButton } from "../../components/forms/PrintFormButton";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { useToast } from "../../components/shared/ToastProvider";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { useWorkflowAction, useWorkflowUpdate } from "../../hooks/useWorkflowAction";

interface Complaint {
  id: number;
  customerName: string | null;
  productAffected: string | null;
  description: string;
  severity: string | null;
  status: string;
  resolution: string | null;
  linkedNcrId: number | null;
}

const complaintHooks = createResourceHooks<Complaint>("complaints");
const SEVERITIES = ["low", "medium", "high", "critical"];

/**
 * Complaint detail: edit the record, move it through open -> investigating ->
 * resolved -> closed (guarded endpoints — status is not editable directly),
 * escalate it to a real NCR, and open its fillable complaint form.
 */
export function ComplaintDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const complaintId = Number(id);
  const historyKey: unknown[][] = [["workflow-history", "complaints", complaintId]];
  const { data: complaint, isLoading, isError } = complaintHooks.useOne(complaintId);

  const investigate = useWorkflowAction("complaints", "investigate", { successMessage: "Investigation started.", invalidateKeys: historyKey });
  const resolve = useWorkflowAction<{ id: number; resolution: string }>("complaints", "resolve", { successMessage: "Marked resolved.", invalidateKeys: historyKey });
  const close = useWorkflowAction("complaints", "close", { successMessage: "Complaint closed.", invalidateKeys: historyKey });
  const escalate = useWorkflowAction("complaints", "escalate-to-ncr", { successMessage: "NCR created and linked.", invalidateKeys: historyKey });
  const save = useWorkflowUpdate<{ id: number } & Record<string, unknown>>("complaints", { successMessage: "Saved.", invalidateKeys: historyKey });

  const [fields, setFields] = useState({ customerName: "", productAffected: "", severity: "", description: "", resolution: "" });
  useEffect(() => {
    if (!complaint) return;
    setFields({
      customerName: complaint.customerName ?? "",
      productAffected: complaint.productAffected ?? "",
      severity: complaint.severity ?? "",
      description: complaint.description,
      resolution: complaint.resolution ?? "",
    });
  }, [complaint]);

  if (isError) return <p className="text-sm text-destructive">Couldn't load this record — try refreshing the page.</p>;
  if (isLoading || !complaint) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const closed = complaint.status === "closed";
  const set = (key: keyof typeof fields) => (e: { target: { value: string } }) => setFields((f) => ({ ...f, [key]: e.target.value }));
  const dirty =
    fields.customerName !== (complaint.customerName ?? "") ||
    fields.productAffected !== (complaint.productAffected ?? "") ||
    fields.severity !== (complaint.severity ?? "") ||
    fields.description !== complaint.description ||
    fields.resolution !== (complaint.resolution ?? "");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">
            Complaint #{complaint.id} {complaint.customerName && <span className="text-muted-foreground">— {complaint.customerName}</span>}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge value={complaint.status} />
            <StatusBadge value={complaint.severity} />
            {complaint.linkedNcrId && (
              <Link to={`/ncr/${complaint.linkedNcrId}`} className="text-xs text-primary hover:underline">
                Linked NCR #{complaint.linkedNcrId}
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <OpenFormButton formType="complaint" entityId={complaint.id} title={`Complaint #${complaint.id} Form`} />
          <PrintFormButton formType="complaint" entityId={complaint.id} />
          <WorkflowActionButton
            label="Escalate to NCR"
            navKey="complaints"
            action={escalate}
            onClick={() => escalate.mutate({ id: complaintId }, { onSuccess: (data) => navigate(`/ncr/${(data as { ncr: { id: number } }).ncr.id}`) })}
            visible={!closed && !complaint.linkedNcrId}
          />
          <WorkflowActionButton
            label="Start Investigation"
            navKey="complaints"
            action={investigate}
            onClick={() => investigate.mutate({ id: complaintId })}
            visible={complaint.status === "open"}
            variant="primary"
          />
          <WorkflowActionButton
            label="Reopen Investigation"
            navKey="complaints"
            action={investigate}
            onClick={() => investigate.mutate({ id: complaintId })}
            visible={complaint.status === "resolved"}
          />
          <WorkflowActionButton
            label="Mark Resolved"
            navKey="complaints"
            action={resolve}
            onClick={() => {
              if (!fields.resolution.trim()) {
                toast.error("Describe the resolution before marking this complaint resolved.");
                return;
              }
              resolve.mutate({ id: complaintId, resolution: fields.resolution });
            }}
            visible={complaint.status === "investigating"}
            variant="primary"
          />
          <WorkflowActionButton label="Close Complaint" navKey="complaints" action={close} onClick={() => close.mutate({ id: complaintId })} visible={complaint.status === "resolved"} variant="primary" />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <TextField label="Customer" value={fields.customerName} onChange={set("customerName")} disabled={closed} />
          <TextField label="Product affected" value={fields.productAffected} onChange={set("productAffected")} disabled={closed} />
          <SelectField label="Severity" value={fields.severity} onChange={set("severity")} disabled={closed}>
            <option value="">Not set</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <TextAreaField label="Description" value={fields.description} onChange={set("description")} disabled={closed} />
          <TextAreaField
            label={complaint.status === "investigating" ? "Resolution (required to mark resolved)" : "Resolution"}
            value={fields.resolution}
            onChange={set("resolution")}
            disabled={closed}
            placeholder="What was done to resolve this complaint"
          />
        </div>
        {!closed && (
          <div className="mt-3 flex justify-end">
            <button
              onClick={() =>
                save.mutate({
                  id: complaintId,
                  customerName: fields.customerName || undefined,
                  productAffected: fields.productAffected || undefined,
                  severity: fields.severity || undefined,
                  description: fields.description,
                  resolution: fields.resolution,
                })
              }
              disabled={!dirty || !fields.description.trim() || save.isPending}
              className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              Save changes
            </button>
          </div>
        )}
      </div>

      <WorkflowHistoryPanel moduleName="complaints" recordId={complaintId} />
      <AttachmentsPanel entityType="complaint" entityId={complaint.id} />
    </div>
  );
}
