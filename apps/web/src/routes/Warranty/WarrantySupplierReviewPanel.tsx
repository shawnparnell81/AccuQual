import { useState } from "react";
import { Link } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { TextAreaField } from "../../components/forms/Field";
import type { WarrantyClaim } from "../../api/types";

const claimHooks = createResourceHooks<WarrantyClaim>("warranty/claims");

/** Shown once a supplier is involved (claim.supplierId set) or the claim has reached supplier_review — relays what the supplier said, since this app has no supplier-facing login for Warranty itself (same as RMA's own "no supplier portal" note). */
export function WarrantySupplierReviewPanel({ claim, canEdit }: { claim: WarrantyClaim; canEdit: boolean }) {
  const updateClaim = claimHooks.useAction("update");
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(claim.supplierReviewNotes ?? "");

  if (!claim.supplierId && claim.status !== "supplier_review") return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-2 text-sm font-medium">Supplier Review</h3>
      {claim.supplier ? (
        <div className="mb-2 text-sm">
          <Link to={`/suppliers/${claim.supplier.id}`} className="font-medium text-primary hover:underline">
            {claim.supplier.name}
          </Link>{" "}
          <StatusBadge value={claim.supplier.status} />
        </div>
      ) : (
        <p className="mb-2 text-sm text-muted-foreground">No supplier linked to this claim.</p>
      )}

      {canEdit && claim.status !== "closed" && editing ? (
        <div className="flex flex-col gap-2">
          <TextAreaField label="Supplier's response" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="flex gap-2">
            <button
              onClick={() => updateClaim.mutate({ id: claim.id, supplierReviewNotes: notes } as never, { onSuccess: () => setEditing(false) })}
              disabled={updateClaim.isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
            >
              {updateClaim.isPending ? "Saving…" : "Save"}
            </button>
            <button onClick={() => setEditing(false)} className="text-xs text-muted-foreground hover:underline">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => canEdit && claim.status !== "closed" && setEditing(true)}
          className={`text-left text-sm text-muted-foreground ${canEdit && claim.status !== "closed" ? "hover:underline" : "cursor-default"}`}
        >
          {claim.supplierReviewNotes || (canEdit ? "Record the supplier's response…" : "No response recorded yet.")}
        </button>
      )}
    </div>
  );
}
