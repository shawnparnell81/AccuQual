import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { useWorkflowAction, extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useCurrentUser } from "../../hooks/useAuth";
import { useToast } from "../../components/shared/ToastProvider";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { SelectField } from "../../components/forms/Field";
import { CrarFormRenderer } from "./CrarFormRenderer";
import type { CrarClaim, CrarStatus, WarrantyClaim, RmaLogRecord, Customer } from "../../api/types";

const crarHooks = createResourceHooks<CrarClaim>("crar");
const warrantyHooks = createResourceHooks<WarrantyClaim>("warranty/claims");
const rmaLogHooks = createResourceHooks<RmaLogRecord>("rma-log");
const customerHooks = createResourceHooks<Customer>("customers");

/** Same allowed-next-status shape as crar.controller.ts's ALLOWED_NEXT — a fixed linear lifecycle, no branching. */
const NEXT_STATUS: Record<CrarStatus, { status: CrarStatus; label: string } | null> = {
  new: { status: "quality_review", label: "Send to Quality Review" },
  quality_review: { status: "warranty_review", label: "Send to Warranty Review" },
  warranty_review: { status: "completed", label: "Mark Completed" },
  completed: null,
};

/** Client mirror of crar.controller.ts's STATUS_TRANSITION_DEPARTMENTS. */
const TRANSITION_DEPARTMENTS: Record<string, string[]> = {
  quality_review: ["quality"],
  warranty_review: ["quality"],
  completed: ["quality", "engineering", "purchasing"],
};
const WARRANTY_LINK_ONLY_DEPARTMENTS = ["engineering", "purchasing"];

export function CrarDetailPage() {
  const { id } = useParams();
  const crarId = Number(id);
  const { data: record, isLoading, isError } = crarHooks.useOne(crarId);
  const { data: warrantyClaims = [] } = warrantyHooks.useList();
  const { data: rmaLogRecords = [] } = rmaLogHooks.useList();
  const { data: customers = [] } = customerHooks.useList();
  const currentUser = useCurrentUser();
  const toast = useToast();
  const queryClient = useQueryClient();
  const updateCrar = crarHooks.useUpdate();
  const auditTrailKey = ["audit-trail", "Crar", crarId];
  const transitionAction = useWorkflowAction<{ id: number; status: string }>("crar", "transition", {
    successMessage: "CRAR status updated.",
    invalidateKeys: [auditTrailKey],
  });

  const [draft, setDraft] = useState<Partial<CrarClaim>>({});
  useEffect(() => {
    if (record) setDraft(record);
  }, [record]);

  if (isError) return <p className="text-sm text-destructive">Couldn't load this record — try refreshing the page.</p>;
  if (isLoading || !record) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const isAdmin = currentUser?.roleName === "admin";
  const department = currentUser?.department;
  const isLinkOnly = !isAdmin && department != null && WARRANTY_LINK_ONLY_DEPARTMENTS.includes(department);
  const canEditContent = isAdmin || department === "quality";
  const isReadOnly = record.status === "completed" || (!canEditContent && !isLinkOnly);
  const next = NEXT_STATUS[record.status];
  const canTransition = next ? isAdmin || (department != null && (TRANSITION_DEPARTMENTS[next.status] ?? []).includes(department)) : false;

  const hasUnsavedChanges = JSON.stringify(draft) !== JSON.stringify(record);

  function save() {
    const patch = isLinkOnly ? { warrantyId: draft.warrantyId } : draft;
    updateCrar.mutate({ id: crarId, ...patch } as never, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: auditTrailKey }),
      onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save this CRAR.")),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">Customer Return Analysis Report {record.customerClaim ? `— ${record.customerClaim}` : `#${record.id}`}</h1>
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
            <button onClick={save} disabled={!hasUnsavedChanges || updateCrar.isPending} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {updateCrar.isPending ? "Saving…" : hasUnsavedChanges ? "Save Changes" : "Saved"}
            </button>
          )}
          {next && (
            <WorkflowActionButton
              label={next.label}
              navKey="crar"
              action={transitionAction}
              onClick={() => transitionAction.mutate({ id: crarId, status: next.status })}
              visible={canTransition}
              variant="primary"
            />
          )}
        </div>
      </div>

      <div className="hidden print:block">
        <h1 className="text-2xl font-semibold">Customer Return Analysis Report — {record.customerClaim ?? `#${record.id}`}</h1>
        <p className="text-sm text-muted-foreground">
          Status: {record.status.replace(/_/g, " ")} — RMA {record.rmaNumber ?? "n/a"} — Part {record.partNumber ?? "n/a"} — Initiated {record.reportDate ? new Date(record.reportDate).toLocaleDateString() : "n/a"}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 print:hidden">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-medium">Linked Warranty Claim</h3>
          {isLinkOnly || canEditContent ? (
            <SelectField label="" value={draft.warrantyId ?? ""} onChange={(e) => setDraft({ ...draft, warrantyId: e.target.value ? Number(e.target.value) : null })}>
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

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-medium">Other Linked Records</h3>
          <div className="flex flex-col gap-1 text-sm">
            {record.linkedNcr ? (
              <Link to={`/ncr/${record.linkedNcr.id}`} className="text-primary hover:underline">
                NCR #{record.linkedNcr.id} — {record.linkedNcr.title}
              </Link>
            ) : (
              <p className="text-muted-foreground">No linked NCR.</p>
            )}
            {record.supplierRequest ? (
              <p className="text-muted-foreground">Supplier RMA Request: {record.supplierRequest.companyName} ({record.supplierRequest.status})</p>
            ) : null}
            {record.linkedRma ? (
              <Link to={`/rma/${record.linkedRma.id}`} className="text-primary hover:underline">
                {record.linkedRma.rmaNumber}
              </Link>
            ) : null}
            {canEditContent ? (
              <SelectField label="" value={draft.rmaLogId ?? ""} onChange={(e) => setDraft({ ...draft, rmaLogId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">None</option>
                {rmaLogRecords.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.rmaNumber}
                  </option>
                ))}
              </SelectField>
            ) : record.linkedRmaLog ? (
              <Link to={`/rma-log/${record.linkedRmaLog.id}`} className="text-primary hover:underline">
                RMA Log {record.linkedRmaLog.rmaNumber} ({record.linkedRmaLog.status.replace(/_/g, " ")})
              </Link>
            ) : (
              <p className="text-muted-foreground">No linked RMA Log entry.</p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-medium">Customer Contact</h3>
          {canEditContent && (
            <SelectField label="" value={draft.customerId ?? ""} onChange={(e) => setDraft({ ...draft, customerId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">None — inherit from linked Warranty claim</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.legalName}
                </option>
              ))}
            </SelectField>
          )}
          {record.customer ? (
            <div className="mt-2 flex flex-col gap-1 text-sm">
              <p className="font-medium">{record.customer.legalName}</p>
              <p className="text-muted-foreground">{record.customer.primaryContactEmail ?? "No email on file"}</p>
              <p className="text-muted-foreground">{record.customer.primaryContactPhone ?? "No phone on file"}</p>
            </div>
          ) : (
            !canEditContent && (
              <p className="text-sm text-muted-foreground">
                No customer linked — set via a linked Warranty claim, or attach an existing customer from the Customer Onboarding module.
              </p>
            )
          )}
        </div>
      </div>

      {isLinkOnly && (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground print:hidden">
          Your department may only link this CRAR to a warranty claim above — the report's own content is Quality's to edit.
        </div>
      )}

      <CrarFormRenderer value={isLinkOnly ? record : draft} onChange={(patch) => setDraft({ ...draft, ...patch })} readOnly={isReadOnly && !isLinkOnly} disabledFields={isLinkOnly ? new Set(Object.keys(record)) : undefined} />

      <div className="print:hidden">
        <AttachmentsPanel entityType="crar" entityId={crarId} title="Evidence, Photos & Supporting Documents" />
      </div>

      {/* Sprint 3 (accuqual-implementation-sequencing.md) — swapped from the
          generic EntityAuditTrailPanel to the shared WorkflowHistoryPanel
          every other module's detail page uses, now that workflow.controller.ts's
          MODULE_ENTITY_TYPES map supports "crar" (Phase 9). */}
      <div className="print:hidden">
        <WorkflowHistoryPanel moduleName="crar" recordId={crarId} />
      </div>
    </div>
  );
}
