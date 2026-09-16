import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { useWorkflowAction, extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useWorkflowAccessLevel } from "../../hooks/useWorkflowAccess";
import { useToast } from "../../components/shared/ToastProvider";
import { apiClient } from "../../api/client";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { SelectField } from "../../components/forms/Field";
import { RmaLogFormRenderer } from "./RmaLogFormRenderer";
import type { RmaLogRecord, RmaLogStatus, WarrantyClaim } from "../../api/types";

const rmaLogHooks = createResourceHooks<RmaLogRecord>("rma-log");
const warrantyHooks = createResourceHooks<WarrantyClaim>("warranty/claims");

const NEXT_STATUS: Record<RmaLogStatus, { status: RmaLogStatus; label: string } | null> = {
  open: { status: "received", label: "Mark Received" },
  received: { status: "under_review", label: "Begin Quality Review" },
  under_review: { status: "dispositioned", label: "Record Disposition" },
  dispositioned: { status: "closed", label: "Close" },
  closed: null,
};

interface AuditRow {
  id: number;
  action: string;
  changes: Record<string, unknown> | null;
  createdAt: string;
}

/** A small, page-specific audit trail viewer — GET /audit-trail/:entityType/:entityId is the app's own generic per-entity endpoint; the shared WorkflowHistoryPanel component's moduleName union doesn't cover rma_log (same as CRAR/Warranty, which don't use it either). */
function AuditTrailPanel({ recordId }: { recordId: number }) {
  const { data: rows = [], isLoading } = useQuery<AuditRow[]>({
    queryKey: ["audit-trail", "RmaLog", recordId],
    queryFn: async () => (await apiClient.get(`/audit-trail/RmaLog/${recordId}`)).data,
  });
  const sorted = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="rounded-lg border border-border bg-card p-4 print:hidden">
      <h3 className="mb-2 text-sm font-medium">Audit Trail</h3>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">No history yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm">
          {sorted.map((r) => (
            <li key={r.id} className="flex items-center justify-between border-b border-border pb-1.5 last:border-0">
              <span className="capitalize">{r.action.replace(/_/g, " ")}</span>
              <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * RMA Log detail page — the JSON-schema form (RmaLogFormRenderer) plus
 * RBAC-controlled edit mode, status transitions, a linkage viewer/editor,
 * and an audit trail viewer, exactly as the module-specific RBAC brief's
 * own frontend requirements list them. Three independent, live, DB-driven
 * permission checks gate this page (see departmentAccess.ts):
 *   - rma_log (base read/write) — content fields, save button.
 *   - rma_log_status — the transition button.
 *   - rma_log_linkage — the Linked Records panel's own edit controls.
 */
export function RmaLogDetailPage() {
  const { id } = useParams();
  const recordId = Number(id);
  const { data: record, isLoading } = rmaLogHooks.useOne(recordId);
  const { data: warrantyClaims = [] } = warrantyHooks.useList();
  const toast = useToast();
  const updateRecord = rmaLogHooks.useUpdate();
  const queryClient = useQueryClient();
  const transitionAction = useWorkflowAction<{ id: number; status: string }>("rma-log", "status", {
    successMessage: "RMA Log status updated.",
    invalidateKeys: [["audit-trail", "RmaLog", recordId]],
  });

  const canWrite = useWorkflowAccessLevel("rma_log") === "edit";
  const canChangeStatus = useWorkflowAccessLevel("rma_log_status") === "edit";
  const canLink = useWorkflowAccessLevel("rma_log_linkage") === "edit";

  const [draft, setDraft] = useState<Partial<RmaLogRecord>>({});
  useEffect(() => {
    if (record) setDraft(record);
  }, [record]);

  if (isLoading || !record) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const isClosed = record.status === "closed";
  const isReadOnly = isClosed || !canWrite;
  const next = NEXT_STATUS[record.status];
  const hasUnsavedChanges = JSON.stringify(draft) !== JSON.stringify(record);

  function save() {
    updateRecord.mutate({ id: recordId, ...draft } as never, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["audit-trail", "RmaLog", recordId] }),
      onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save this RMA Log entry.")),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">RMA Log — {record.rmaNumber}</h1>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge value={record.status} />
            <span className="text-sm text-muted-foreground">{record.customerName ?? "No customer on file"}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => window.print()} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Print
          </button>
          {!isReadOnly && (
            <button onClick={save} disabled={!hasUnsavedChanges || updateRecord.isPending} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {updateRecord.isPending ? "Saving…" : hasUnsavedChanges ? "Save Changes" : "Saved"}
            </button>
          )}
          {next && (
            <WorkflowActionButton
              label={next.label}
              navKey="rma_log_status"
              action={transitionAction}
              onClick={() => transitionAction.mutate({ id: recordId, status: next.status })}
              visible={canChangeStatus}
              variant="primary"
            />
          )}
        </div>
      </div>

      <div className="hidden print:block">
        <h1 className="text-2xl font-semibold">RMA Log — {record.rmaNumber}</h1>
        <p className="text-sm text-muted-foreground">
          Status: {record.status.replace(/_/g, " ")} — {record.customerName ?? "No customer on file"} — Issued {new Date(record.dateIssued).toLocaleDateString()}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 print:hidden">
        <h3 className="mb-2 text-sm font-medium">Linked Records</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Warranty Claim</p>
            {canLink ? (
              <SelectField
                label=""
                value={draft.warrantyId ?? ""}
                onChange={(e) => setDraft({ ...draft, warrantyId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">None</option>
                {warrantyClaims.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.claimNumber}
                  </option>
                ))}
              </SelectField>
            ) : record.warranty ? (
              <Link to={`/warranty/${record.warranty.id}`} className="text-sm text-primary hover:underline">
                {record.warranty.claimNumber}
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">Not linked.</p>
            )}
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Supplier RMA Request</p>
            {record.supplierRequest ? (
              <p className="text-sm text-muted-foreground">
                {record.supplierRequest.companyName} ({record.supplierRequest.status})
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Not linked.</p>
            )}
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Quality (NCR)</p>
            {record.linkedNcr ? (
              <Link to={`/ncr/${record.linkedNcr.id}`} className="text-sm text-primary hover:underline">
                NCR #{record.linkedNcr.id} — {record.linkedNcr.title}
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">Not linked.</p>
            )}
          </div>
        </div>
        {!canLink && <p className="mt-3 text-xs text-muted-foreground">Linking requires the rma_log.linkage.write permission.</p>}
      </div>

      <RmaLogFormRenderer value={draft} onChange={(patch) => setDraft({ ...draft, ...patch })} readOnly={isReadOnly} />

      <div className="print:hidden">
        <AttachmentsPanel entityType="rma_log" entityId={recordId} title="Evidence, Photos & Supporting Documents" />
      </div>

      <AuditTrailPanel recordId={recordId} />
    </div>
  );
}
