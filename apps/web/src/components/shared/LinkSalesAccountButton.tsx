import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { SalesAccount, SalesRelatedSourceType } from "../../api/types";
import { Modal } from "../modals/Modal";
import { TextField, TextAreaField, SelectField } from "../forms/Field";

const salesAccountHooks = createResourceHooks<SalesAccount>("sales/accounts");

interface LinkSalesAccountButtonProps {
  /** One of the module's seven real integration points — see sales.validation.ts's SALES_RELATED_SOURCE_TYPES. */
  sourceType: SalesRelatedSourceType;
  sourceId: number;
  defaultAccountName?: string;
  label?: string;
}

/**
 * The one "Link to Sales Account" button/modal, reused on NCR, PPAP, Change
 * Management, Work Orders, Requisitions, PO, and RMA detail pages — see the
 * Sales & Marketing module's Integration Points requirement. Links to an
 * EXISTING account (picked from the list) or creates a new one inline, then
 * records the link as a real sales_activities row via the same append-only
 * activity log the account's own page uses for CRM notes — no separate join
 * table, same reasoning as CreateFeasibilityButton/CreateRiskButton being
 * one shared component reused across every source page.
 */
export function LinkSalesAccountButton({ sourceType, sourceId, defaultAccountName, label = "Sales Account" }: LinkSalesAccountButtonProps) {
  const navigate = useNavigate();
  const accountsQuery = salesAccountHooks.useList();
  const createAccount = salesAccountHooks.useCreate();
  const createActivity = salesAccountHooks.useAction("activities");
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [accountId, setAccountId] = useState("");
  const [newAccountName, setNewAccountName] = useState(defaultAccountName ?? "");
  const [notes, setNotes] = useState("");

  const accounts = accountsQuery.data ?? [];
  const busy = createAccount.isPending || createActivity.isPending;

  async function linkTo(id: number) {
    await createActivity.mutateAsync({
      id,
      activityType: "note",
      notes: notes || `Linked from ${sourceType} #${sourceId}`,
      relatedSourceType: sourceType,
      relatedSourceId: sourceId,
    } as never);
    setOpen(false);
    navigate(`/sales/${id}`);
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
        {label}
      </button>
      <Modal title={`Link this ${sourceType} to a Sales Account`} isOpen={open} onClose={() => setOpen(false)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (mode === "existing") {
              if (!accountId) return;
              await linkTo(Number(accountId));
            } else {
              const created = await createAccount.mutateAsync({ customerName: newAccountName } as never);
              await linkTo(created.id);
            }
          }}
        >
          <div className="flex gap-2 text-xs">
            <button type="button" onClick={() => setMode("existing")} className={`rounded-md border px-2 py-1 ${mode === "existing" ? "border-primary bg-primary/10" : "border-border"}`}>
              Existing account
            </button>
            <button type="button" onClick={() => setMode("new")} className={`rounded-md border px-2 py-1 ${mode === "new" ? "border-primary bg-primary/10" : "border-border"}`}>
              New account
            </button>
          </div>
          {mode === "existing" ? (
            <SelectField label="Sales Account" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
              <option value="">Select an account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.customerName} ({a.status})
                </option>
              ))}
            </SelectField>
          ) : (
            <TextField label="Customer name" value={newAccountName} onChange={(e) => setNewAccountName(e.target.value)} required />
          )}
          <TextAreaField label="Note (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={`Linked from ${sourceType} #${sourceId}`} />
          <p className="text-xs text-muted-foreground">Recorded as an activity on the account, linked back to this {sourceType} (#{sourceId}).</p>
          <button type="submit" disabled={busy} className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {busy ? "Linking…" : "Link"}
          </button>
        </form>
      </Modal>
    </>
  );
}
