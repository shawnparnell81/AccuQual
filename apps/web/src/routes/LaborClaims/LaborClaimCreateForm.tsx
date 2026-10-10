import { useState } from "react";
import { createResourceHooks } from "../../api/resourceHooks";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { Modal } from "../../components/modals/Modal";
import { RecordNumberField, duplicateNumberError } from "../../components/forms/RecordNumberField";
import { TextField, SelectField, TextAreaField } from "../../components/forms/Field";
import { recordHeading } from "../../lib/userRecordNumber";
import type { LaborClaim, LaborClaimStatus } from "./laborClaim";

const claimHooks = createResourceHooks<LaborClaim>("labor-claims");
const STATUSES: LaborClaimStatus[] = ["open", "pending", "approved", "denied", "closed"];

const blank = {
  claimNumber: "",
  claimDate: "",
  customerName: "",
  partName: "",
  laborHours: "",
  laborRate: "",
  totalLaborCost: "",
  warrantyClaimId: "",
  ncrId: "",
  status: "open" as LaborClaimStatus,
  notes: "",
};

/** Claim number is required and typed. The server never assigns the next number. */
export function LaborClaimCreateForm({ isOpen, onClose, onCreated }: { isOpen: boolean; onClose: () => void; onCreated: (claim: LaborClaim) => void }) {
  const toast = useToast();
  const createClaim = claimHooks.useCreate();
  const [form, setForm] = useState(blank);
  const [numberError, setNumberError] = useState<string | null>(null);

  function link(value: string): number | null {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  return (
    <Modal title="New Labor Claim" isOpen={isOpen} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!form.claimNumber.trim()) {
            setNumberError("Type a claim number.");
            return;
          }
          createClaim.mutate(
            {
              claimNumber: form.claimNumber.trim(),
              claimDate: form.claimDate || null,
              customerName: form.customerName || null,
              partName: form.partName || null,
              laborHours: form.laborHours === "" ? null : form.laborHours,
              laborRate: form.laborRate === "" ? null : form.laborRate,
              totalLaborCost: form.totalLaborCost === "" ? null : form.totalLaborCost,
              warrantyClaimId: link(form.warrantyClaimId),
              ncrId: link(form.ncrId),
              status: form.status,
              notes: form.notes || null,
            } as never,
            {
              onSuccess: (created) => {
                toast.success(`${recordHeading("Labor claim", created.claimNumber)} created.`);
                setForm(blank);
                setNumberError(null);
                onClose();
                onCreated(created);
              },
              onError: (err) => {
                const message = extractErrorMessage(err, "Couldn't create the labor claim.");
                const duplicate = duplicateNumberError(message);
                if (duplicate) setNumberError(duplicate);
                else toast.error(message);
              },
            },
          );
        }}
      >
        <RecordNumberField label="Claim No." value={form.claimNumber} error={numberError} onChange={(value) => { setNumberError(null); setForm({ ...form, claimNumber: value }); }} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Date" type="date" value={form.claimDate} onChange={(event) => setForm({ ...form, claimDate: event.target.value })} />
          <SelectField label="Status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as LaborClaimStatus })}>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </SelectField>
        </div>
        <TextField label="Customer" value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} />
        <TextField label="Part / product" value={form.partName} onChange={(event) => setForm({ ...form, partName: event.target.value })} />
        <div className="grid grid-cols-3 gap-3">
          <TextField label="Labor hours" type="number" min="0" step="0.01" value={form.laborHours} onChange={(event) => setForm({ ...form, laborHours: event.target.value })} />
          <TextField label="Labor rate" type="number" min="0" step="0.01" value={form.laborRate} onChange={(event) => setForm({ ...form, laborRate: event.target.value })} />
          <TextField label="Total labor cost" type="number" min="0" step="0.01" value={form.totalLaborCost} onChange={(event) => setForm({ ...form, totalLaborCost: event.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Warranty claim id" type="number" min="1" value={form.warrantyClaimId} onChange={(event) => setForm({ ...form, warrantyClaimId: event.target.value })} />
          <TextField label="NCR id" type="number" min="1" value={form.ncrId} onChange={(event) => setForm({ ...form, ncrId: event.target.value })} />
        </div>
        <TextAreaField label="Notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        <button type="submit" disabled={createClaim.isPending} className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
          {createClaim.isPending ? "Creating…" : "Create Claim"}
        </button>
      </form>
    </Modal>
  );
}
