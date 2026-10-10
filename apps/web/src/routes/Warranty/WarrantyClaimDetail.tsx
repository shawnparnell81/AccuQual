import { useParams, Link } from "react-router-dom";
import { isFullAccessRole } from "../../lib/fullAccess";
import { createResourceHooks } from "../../api/resourceHooks";
import { useWorkflowAction } from "../../hooks/useWorkflowAction";
import { useWorkflowAccessLevel } from "../../hooks/useWorkflowAccess";
import { useCurrentUser } from "../../hooks/useAuth";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { DeleteRecordButton } from "../../components/shared/DeleteRecordButton";
import { WarrantyInspectionPanel } from "./WarrantyInspectionPanel";
import { WarrantySupplierReviewPanel } from "./WarrantySupplierReviewPanel";
import { WarrantyCostPanel } from "./WarrantyCostPanel";
import { WarrantyDocumentsPanel } from "./WarrantyDocumentsPanel";
import { WarrantyCrarPanel } from "./WarrantyCrarPanel";
import { AiStructuredSuggestion } from "../../components/shared/AiStructuredSuggestion";
import type { WarrantyClaim, WarrantyStatus } from "../../api/types";
import { RecordNumberEditor } from "../../components/forms/RecordNumberField";
import { RecordSiteField } from "../../components/records/RecordSiteField";
import { formatDate } from "../../lib/dates";
import { recordHeading } from "../../lib/userRecordNumber";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { RecordAccessMessage } from "../../components/shared/RecordAccessMessage";

const claimHooks = createResourceHooks<WarrantyClaim>("warranty/claims");

interface WarrantyTriageSuggestion {
  suggestedDisposition: "approve" | "deny" | "needs_inspection";
  estimatedCost: number | null;
  rationale: string;
}

/** Same allowed-next-status shape as warranty.controller.ts's ALLOWED_NEXT — duplicated here only for which buttons to show; the server re-validates on every call. */
const NEXT_STATUS: Record<WarrantyStatus, { status: WarrantyStatus; label: string }[]> = {
  new: [{ status: "inspection", label: "Begin Inspection" }],
  inspection: [{ status: "supplier_review", label: "Send to Supplier Review" }],
  supplier_review: [
    { status: "approved", label: "Approve" },
    { status: "rejected", label: "Reject" },
  ],
  approved: [
    { status: "replaced", label: "Mark Replaced" },
    { status: "repaired", label: "Mark Repaired" },
  ],
  rejected: [{ status: "closed", label: "Close Claim" }],
  replaced: [{ status: "closed", label: "Close Claim" }],
  repaired: [{ status: "closed", label: "Close Claim" }],
  closed: [],
};

/** Client-side mirror of warranty.controller.ts's STATUS_TRANSITION_DEPARTMENTS — a UI convenience, not the enforcement (server-side, re-checked on every call). */
const TRANSITION_DEPARTMENTS: Record<string, string[]> = {
  inspection: ["quality", "engineering"],
  supplier_review: ["quality", "engineering"],
  approved: ["quality"],
  rejected: ["quality"],
  replaced: ["quality", "customer_service"],
  repaired: ["quality", "customer_service"],
  closed: ["quality", "customer_service"],
};

export function WarrantyClaimDetail() {
  const { id } = useParams();
  const claimId = Number(id);
  const { data: claim, isLoading, isError, error } = claimHooks.useOne(claimId);
  const updateClaim = claimHooks.useUpdate();
  const currentUser = useCurrentUser();
  const warrantyAccessLevel = useWorkflowAccessLevel("warranty");

  const transitionAction = useWorkflowAction<{ id: number; status: string }>("warranty/claims", "transition", {
    successMessage: "Warranty claim status updated.",
  });

  if (isError) return <RecordAccessMessage error={error} fallback="Couldn't load this record — try refreshing the page." noun="this warranty claim" />;
  if (isLoading || !claim) return <LoadingPlaceholder />;

  const isAdmin = isFullAccessRole(currentUser?.roleName);
  const department = currentUser?.department;
  // Field-edit access (inspection notes, supplier review notes, POST
  // .../update) — module-specific RBAC build (2026-09-16): a live,
  // DB-driven check (warranty.write) mirroring warranty.controller.ts's own
  // assertWarrantyContentWrite exactly, rather than a hardcoded department
  // list that couldn't reflect an administrator's own self-service grants.
  const canEditFields = isAdmin || (department !== "purchasing" && warrantyAccessLevel === "edit");
  // Cost entries — quality/purchasing only, matching createWarrantyCostHandler
  // (a genuine, still-hardcoded structural carve-out on the backend, not a
  // separate configurable permission — see that handler's own comment).
  const canEditCosts = isAdmin || department === "quality" || department === "purchasing";
  const nextActions = NEXT_STATUS[claim.status] ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">{recordHeading("Warranty claim", claim.claimNumber)}</h1>
          <RecordNumberEditor label="Claim No." value={claim.claimNumber} canEdit={canEditFields} onSave={(next) => updateClaim.mutateAsync({ id: claim.id, claimNumber: next.trim() || null })} />
          <RecordSiteField entity="warranty" id={claim.id} canEdit={canEditFields} />
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge value={claim.status} />
          </div>
        </div>
        <div className="flex gap-2">
          <DeleteRecordButton resource="warranty/claims" id={claim.id} kind="Warranty claim" title={claim.failureDescription} number={claim.claimNumber} ownerIds={[claim.createdByUserId]} navigateTo="/warranty" />
        </div>
      </div>

      <div className="hidden print:block">
        <h1 className="text-2xl font-semibold">{recordHeading("Warranty claim", claim.claimNumber)}</h1>
        <p className="text-sm text-muted-foreground">
          Status: {claim.status.replace(/_/g, " ")}
        </p>
      </div>

      {claim.status !== "closed" && (
        <div className="rounded-lg border border-border bg-card p-4 print:hidden">
          <h3 className="mb-3 text-sm font-medium">Status</h3>
          <div className="flex flex-wrap gap-2">
            {nextActions.map((next) => {
              const allowed = isAdmin || (department != null && (TRANSITION_DEPARTMENTS[next.status] ?? []).includes(department));
              return (
                <WorkflowActionButton
                  key={next.status}
                  label={next.label}
                  navKey="warranty"
                  action={transitionAction}
                  onClick={() => transitionAction.mutate({ id: claimId, status: next.status })}
                  visible={allowed}
                  variant={next.status === "rejected" ? "outline" : "primary"}
                />
              );
            })}
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-medium">Product</h3>
          {claim.product ? (
            <>
              <p className="text-sm font-medium">{claim.product.sku}</p>
              <p className="text-sm text-muted-foreground">{claim.product.description ?? "No description"}</p>
            </>
          ) : claim.productNumber ? (
            <p className="text-sm font-medium">{claim.productNumber}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No product on file.</p>
          )}
          {claim.serialNumber && <p className="mt-1 text-xs text-muted-foreground">S/N {claim.serialNumber}</p>}
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">Failure</h3>
            <AiStructuredSuggestion<WarrantyTriageSuggestion>
              endpoint="/ai/warranty-triage"
              title="AI Triage Suggestion"
              triggerLabel="AI Triage"
              acceptLabel="Acknowledge"
              buildPayload={() => ({
                claimId,
                input: {
                  failureDescription: claim.failureDescription,
                  product: claim.product?.sku,
                  serialNumber: claim.serialNumber,
                  failureDate: claim.failureDate,
                },
              })}
              // No onAccept — Phase 5 explicitly requires this suggestion never
              // auto-populates a field; the real disposition is only ever
              // recorded through the Inspection / Supplier Review panels below.
              renderPreview={(output) => (
                <div className="flex flex-col gap-2 text-sm">
                  <p>
                    Suggested disposition: <strong className="capitalize">{output.suggestedDisposition.replace(/_/g, " ")}</strong>
                  </p>
                  {output.estimatedCost !== null && (
                    <p>
                      Estimated cost: <strong>${output.estimatedCost.toFixed(2)}</strong>
                    </p>
                  )}
                  <p className="text-muted-foreground">{output.rationale}</p>
                  <p className="text-xs text-muted-foreground">
                    A suggestion only — record the real disposition through the Inspection / Supplier Review panels below.
                  </p>
                </div>
              )}
            />
          </div>
          <p className="text-sm text-muted-foreground">{claim.failureDescription || "No description provided."}</p>
          {claim.failureDate && <p className="mt-1 text-xs text-muted-foreground">Reported {formatDate(claim.failureDate)}</p>}
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-medium">Linked Records</h3>
          {claim.linkedNcr ? (
            <Link to={`/ncr/${claim.linkedNcr.id}`} className="block text-sm text-primary hover:underline">
              {claim.linkedNcr.title || "NCR"}
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">No linked NCR.</p>
          )}
          {claim.linkedWorkOrder ? (
            <Link to={`/work-orders/${claim.linkedWorkOrder.id}`} className="mt-1 block text-sm text-primary hover:underline">
              Work order
            </Link>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">No linked Work Order.</p>
          )}
        </div>
      </div>

      <WarrantyInspectionPanel claim={claim} canEdit={canEditFields} />
      <WarrantySupplierReviewPanel claim={claim} canEdit={canEditFields} />
      <WarrantyCostPanel claimId={claimId} actualCost={claim.warrantyActualCost} canEdit={canEditCosts} />
      <WarrantyCrarPanel claimId={claimId} />

      <div className="print:hidden">
        <WarrantyDocumentsPanel claimId={claimId} />
      </div>

      {claim.workflow && claim.workflow.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 print:hidden">
          <h3 className="mb-2 text-sm font-medium">History</h3>
          <ul className="flex flex-col gap-1.5 text-sm">
            {claim.workflow.map((w) => (
              <li key={w.id} className="flex items-center justify-between border-b border-border pb-1.5 last:border-0">
                <span>
                  {w.fromStatus ? `${w.fromStatus.replace(/_/g, " ")} → ` : ""}
                  <strong>{w.toStatus.replace(/_/g, " ")}</strong>
                  {w.note && <span className="text-muted-foreground"> — {w.note}</span>}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{w.performedByName ?? "System"}</span>
                  <span>{new Date(w.createdAt).toLocaleString()}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
