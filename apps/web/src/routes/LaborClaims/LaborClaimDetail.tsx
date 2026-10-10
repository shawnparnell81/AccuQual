import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { useWorkflowAccessLevel } from "../../hooks/useWorkflowAccess";
import { useModuleFormLock } from "../../hooks/useSavedFormMode";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { DeleteRecordButton } from "../../components/shared/DeleteRecordButton";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { ModuleFormLock } from "../../components/forms/SavedFormLockBar";
import { RecordNumberField } from "../../components/forms/RecordNumberField";
import { SelectField, TextAreaField, TextField } from "../../components/forms/Field";
import { RecordSiteField } from "../../components/records/RecordSiteField";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { recordHeading } from "../../lib/userRecordNumber";
import type { LaborClaim, LaborClaimStatus } from "./laborClaim";

const claimHooks = createResourceHooks<LaborClaim>("labor-claims");
const STATUSES: LaborClaimStatus[] = ["open", "pending", "approved", "denied", "closed"];

function dayValue(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 10);
}

function draftFrom(claim: LaborClaim) {
  return {
    claimNumber: claim.claimNumber ?? "",
    claimDate: dayValue(claim.claimDate),
    customerName: claim.customerName ?? "",
    partName: claim.partName ?? "",
    laborHours: claim.laborHours ?? "",
    laborRate: claim.laborRate ?? "",
    totalLaborCost: claim.totalLaborCost ?? "",
    warrantyClaimId: claim.warrantyClaimId == null ? "" : String(claim.warrantyClaimId),
    ncrId: claim.ncrId == null ? "" : String(claim.ncrId),
    status: claim.status,
    notes: claim.notes ?? "",
  };
}

export function LaborClaimDetail() {
  const { id } = useParams();
  const claimId = Number(id);
  const toast = useToast();
  const { data: claim, isLoading, isError } = claimHooks.useOne(claimId);
  const updateClaim = claimHooks.useUpdate();
  const canEdit = useWorkflowAccessLevel("labor_claims") === "edit";
  const formLock = useModuleFormLock(claimId, canEdit, `/labor-claims/${claimId}/begin-edit`);
  const [draft, setDraft] = useState<ReturnType<typeof draftFrom> | null>(null);
  const [numberError, setNumberError] = useState<string | null>(null);

  useEffect(() => {
    if (claim) setDraft(draftFrom(claim));
  }, [claim]);

  if (isError) return <p className="text-sm text-destructive">Couldn't load this record — try refreshing the page.</p>;
  if (isLoading || !claim || !draft) return <LoadingPlaceholder />;

  const locked = !formLock.fieldsEditable;

  async function save() {
    if (!draft || !claim) return;
    if (!draft.claimNumber.trim()) {
      setNumberError("Type a claim number.");
      return;
    }
    const link = (value: string) => {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    };
    try {
      await updateClaim.mutateAsync({
        id: claim.id,
        claimNumber: draft.claimNumber.trim(),
        claimDate: draft.claimDate || null,
        customerName: draft.customerName || null,
        partName: draft.partName || null,
        laborHours: draft.laborHours === "" ? null : draft.laborHours,
        laborRate: draft.laborRate === "" ? null : draft.laborRate,
        totalLaborCost: draft.totalLaborCost === "" ? null : draft.totalLaborCost,
        warrantyClaimId: link(draft.warrantyClaimId),
        ncrId: link(draft.ncrId),
        status: draft.status,
        notes: draft.notes || null,
      });
      toast.success("Labor claim saved.");
    } catch (err) {
      const message = extractErrorMessage(err, "Couldn't save this labor claim.");
      if (/already/i.test(message) || /duplicate/i.test(message)) setNumberError(message);
      else toast.error(message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/labor-claims" className="text-xs text-muted-foreground hover:text-primary">
            Labor Claims
          </Link>
          <h1 className="text-2xl font-semibold">{recordHeading("Labor claim", claim.claimNumber)}</h1>
          <div className="mt-1">
            <StatusBadge value={claim.status} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ModuleFormLock mode={formLock.mode} canEdit={canEdit} pending={updateClaim.isPending} onEdit={() => formLock.onEdit()} onSave={() => void save()} onLock={formLock.lock} />
          <DeleteRecordButton resource="labor-claims" id={claim.id} kind="Labor claim" title={claim.partName} number={claim.claimNumber} ownerIds={[claim.createdByUserId]} navigateTo="/labor-claims" />
        </div>
      </div>

      <RecordSiteField entity="labor_claim" id={claim.id} canEdit={formLock.fieldsEditable} />

      <form
        className="grid gap-4 rounded-lg border border-border bg-card p-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <RecordNumberField
          label="Claim No."
          value={draft.claimNumber}
          disabled={locked}
          error={numberError}
          onChange={(value) => {
            setNumberError(null);
            setDraft({ ...draft, claimNumber: value });
          }}
        />
        <TextField label="Date" type="date" value={draft.claimDate} disabled={locked} onChange={(event) => setDraft({ ...draft, claimDate: event.target.value })} />
        <TextField label="Customer" value={draft.customerName} disabled={locked} onChange={(event) => setDraft({ ...draft, customerName: event.target.value })} />
        <TextField label="Part / product" value={draft.partName} disabled={locked} onChange={(event) => setDraft({ ...draft, partName: event.target.value })} />
        <TextField label="Labor hours" type="number" min="0" step="0.01" value={draft.laborHours} disabled={locked} onChange={(event) => setDraft({ ...draft, laborHours: event.target.value })} />
        <TextField label="Labor rate" type="number" min="0" step="0.01" value={draft.laborRate} disabled={locked} onChange={(event) => setDraft({ ...draft, laborRate: event.target.value })} />
        <TextField label="Total labor cost" type="number" min="0" step="0.01" value={draft.totalLaborCost} disabled={locked} onChange={(event) => setDraft({ ...draft, totalLaborCost: event.target.value })} />
        <SelectField label="Status" value={draft.status} disabled={locked} onChange={(event) => setDraft({ ...draft, status: event.target.value as LaborClaimStatus })}>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </SelectField>
        <TextField label="Warranty claim id" type="number" min="1" value={draft.warrantyClaimId} disabled={locked} onChange={(event) => setDraft({ ...draft, warrantyClaimId: event.target.value })} />
        <TextField label="NCR id" type="number" min="1" value={draft.ncrId} disabled={locked} onChange={(event) => setDraft({ ...draft, ncrId: event.target.value })} />
        <div className="md:col-span-2">
          <TextAreaField label="Notes" value={draft.notes} disabled={locked} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
        </div>
      </form>

      <div className="rounded-lg border border-border bg-card p-4 text-sm">
        <h2 className="mb-2 font-medium">Related records</h2>
        {claim.warrantyClaim ? (
          <Link to={`/warranty/${claim.warrantyClaim.id}`} className="block text-primary hover:underline">
            Warranty {claim.warrantyClaim.claimNumber?.trim() || `#${claim.warrantyClaim.id}`}
          </Link>
        ) : (
          <p className="text-muted-foreground">No linked warranty claim.</p>
        )}
        {claim.linkedNcr ? (
          <Link to={`/ncr/${claim.linkedNcr.id}`} className="mt-1 block text-primary hover:underline">
            {claim.linkedNcr.title || `NCR #${claim.linkedNcr.id}`}
          </Link>
        ) : (
          <p className="mt-1 text-muted-foreground">No linked NCR.</p>
        )}
      </div>

      <WorkflowHistoryPanel moduleName="labor_claims" recordId={claimId} />
    </div>
  );
}
