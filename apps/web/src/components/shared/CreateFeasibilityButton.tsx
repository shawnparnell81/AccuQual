import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { FeasibilityReview, FeasibilitySourceType } from "../../api/types";
import { Modal } from "../modals/Modal";
import { TextField, TextAreaField } from "../forms/Field";

const feasibilityHooks = createResourceHooks<FeasibilityReview>("feasibility");

interface CreateFeasibilityButtonProps {
  /** One of the module's ten real integration points (incl. Customer Onboarding) — future_product never reaches here, see feasibilityConstants.ts. */
  sourceType: FeasibilitySourceType;
  sourceId: number;
  defaultTitle: string;
  defaultDepartment?: string;
  label?: string;
}

/**
 * The one "Create Feasibility Review" button/modal, reused on NCR, Supplier,
 * Complaints, PPAP, Change Management, Work Orders, Requisitions, PO, and
 * RMA detail pages — see the Feasibility Review module's Integration Points
 * requirement. A single shared component so all nine stay in sync, same
 * reasoning as CreateRiskButton.
 */
export function CreateFeasibilityButton({ sourceType, sourceId, defaultTitle, defaultDepartment, label = "Feasibility Review" }: CreateFeasibilityButtonProps) {
  const navigate = useNavigate();
  const createFeasibility = feasibilityHooks.useCreate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState("");
  const [department, setDepartment] = useState(defaultDepartment ?? "");

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
        {label}
      </button>
      <Modal title={`Create Feasibility Review from this ${sourceType.replace(/_/g, " ")}`} isOpen={open} onClose={() => setOpen(false)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            createFeasibility.mutate(
              { title, description: description || undefined, department: department || undefined, sourceType, sourceId } as never,
              { onSuccess: (created) => navigate(`/feasibility/${created.id}`) }
            );
          }}
        >
          <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <TextAreaField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <TextField label="Owning department (optional)" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="quality, engineering, production…" />
          <p className="text-xs text-muted-foreground">Linked to this {sourceType.replace(/_/g, " ")} (#{sourceId}) automatically. Scoring dimensions and a decision are added from the new review's own page.</p>
          <button type="submit" disabled={createFeasibility.isPending} className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {createFeasibility.isPending ? "Creating…" : "Create"}
          </button>
        </form>
      </Modal>
    </>
  );
}
