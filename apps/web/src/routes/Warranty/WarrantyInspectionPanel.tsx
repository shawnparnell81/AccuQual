import { useState } from "react";
import { createResourceHooks } from "../../api/resourceHooks";
import { TextField, TextAreaField } from "../../components/forms/Field";
import type { WarrantyClaim } from "../../api/types";

const claimHooks = createResourceHooks<WarrantyClaim>("warranty/claims");

/** Engineering/Quality's inspection findings — POST /warranty/claims/:id/update (see warranty.controller.ts's own literal path). Editable while the claim isn't closed; canEdit is the caller's own department check. */
export function WarrantyInspectionPanel({ claim, canEdit }: { claim: WarrantyClaim; canEdit: boolean }) {
  const updateClaim = claimHooks.useAction("update");
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(claim.inspectionNotes ?? "");
  const [date, setDate] = useState(claim.inspectionDate ? claim.inspectionDate.slice(0, 10) : "");

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Inspection</h3>
        {canEdit && claim.status !== "closed" && !editing && (
          <button onClick={() => setEditing(true)} className="text-xs text-primary hover:underline">
            {claim.inspectionNotes ? "Edit" : "Add findings"}
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-2 flex flex-col gap-2">
          <TextField label="Inspection Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <TextAreaField label="Findings" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="flex gap-2">
            <button
              onClick={() =>
                updateClaim.mutate(
                  { id: claim.id, inspectionNotes: notes, inspectionDate: date || undefined } as never,
                  { onSuccess: () => setEditing(false) }
                )
              }
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
        <div className="mt-2 text-sm">
          <p className="text-muted-foreground">{claim.inspectionNotes || "No inspection findings recorded yet."}</p>
          {claim.inspectionDate && <p className="mt-1 text-xs text-muted-foreground">Inspected {new Date(claim.inspectionDate).toLocaleDateString()}</p>}
        </div>
      )}
    </div>
  );
}
