import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { Customer, CustomerRelatedSourceType } from "../../api/types";
import { Modal } from "../modals/Modal";
import { TextField } from "../forms/Field";

const customerHooks = createResourceHooks<Customer>("customers");

interface CreateCustomerButtonProps {
  /** One of the module's real integration points — see customers.validation.ts's CUSTOMER_RELATED_SOURCE_TYPES. */
  sourceType: CustomerRelatedSourceType;
  sourceId: number;
  defaultLegalName: string;
  label?: string;
}

/**
 * The one "Start Customer Onboarding" button/modal, reused on NCR, Supplier,
 * Work Orders, Requisitions, PO, RMA, Risk, Feasibility, and Sales Account
 * detail pages — see the Customer Onboarding module's Integration Points.
 * A single shared component so all nine stay in sync, same reasoning as
 * CreateRiskButton/CreateFeasibilityButton.
 */
export function CreateCustomerButton({ sourceType, sourceId, defaultLegalName, label = "Start Customer Onboarding" }: CreateCustomerButtonProps) {
  const navigate = useNavigate();
  const createCustomer = customerHooks.useCreate();
  const [open, setOpen] = useState(false);
  const [legalName, setLegalName] = useState(defaultLegalName);
  const [industry, setIndustry] = useState("");

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
        {label}
      </button>
      <Modal title={`Start Customer Onboarding from this ${sourceType}`} isOpen={open} onClose={() => setOpen(false)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            createCustomer.mutate(
              { legalName, industry: industry || undefined, relatedSourceType: sourceType, relatedSourceId: sourceId } as never,
              { onSuccess: (created) => navigate(`/customers/${created.id}`) }
            );
          }}
        >
          <TextField label="Customer legal name" value={legalName} onChange={(e) => setLegalName(e.target.value)} required />
          <TextField label="Industry (optional)" value={industry} onChange={(e) => setIndustry(e.target.value)} />
          <p className="text-xs text-muted-foreground">Linked to this {sourceType} (#{sourceId}) automatically. Requirements, NDA, and the review workflow are added from the new case's own page.</p>
          <button type="submit" disabled={createCustomer.isPending} className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {createCustomer.isPending ? "Creating…" : "Create"}
          </button>
        </form>
      </Modal>
    </>
  );
}
