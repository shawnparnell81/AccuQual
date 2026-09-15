import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { FeasibilityReview } from "../../api/types";

const feasibilityHooks = createResourceHooks<FeasibilityReview>("feasibility");

interface CreateFeasibilityButtonProps {
  customerId: number;
  customerName: string;
}

/**
 * The Feasibility Review module's ONE remaining real integration point — per
 * explicit request, narrowed from 9 cross-module buttons (NCR/Supplier/
 * Complaints/PPAP/Change/WorkOrders/Requisitions/PO/RMA) down to just this
 * one (Customer Onboarding) plus a direct Engineering nav entry. Creates a
 * blank review with customerId/customerName prefilled and opens it
 * immediately — every other field (RFQ #, part #, the 7-area assessment,
 * sign-offs) is filled on the review's own page, same as before.
 */
export function CreateFeasibilityButton({ customerId, customerName }: CreateFeasibilityButtonProps) {
  const navigate = useNavigate();
  const createFeasibility = feasibilityHooks.useCreate();

  return (
    <button
      type="button"
      onClick={() =>
        createFeasibility.mutate({ customerId, customerName } as never, { onSuccess: (created) => navigate(`/feasibility/${created.id}`) })
      }
      disabled={createFeasibility.isPending}
      className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
    >
      {createFeasibility.isPending ? "Creating…" : "Feasibility Review"}
    </button>
  );
}
