import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { createResourceHooks } from "../../api/resourceHooks";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { TextField, SelectField } from "../../components/forms/Field";
import type { Supplier, InventoryItem, ErpPurchaseOrder } from "../../api/types";

const supplierHooks = createResourceHooks<Supplier>("suppliers");
const itemHooks = createResourceHooks<InventoryItem>("inventory/items");

interface DraftLine {
  itemId: string;
  quantity: string;
  unitCost: string;
  notes: string;
}

const emptyLine = (): DraftLine => ({ itemId: "", quantity: "", unitCost: "", notes: "" });

/**
 * A real dedicated page, not the JSON-schema form engine — that system is
 * for fixed-schema printable documents (Supplier Record, Item Record), not
 * a form with dynamically added rows bound to live inventory items fetched
 * from the API. Same call every other module's real data-entry makes.
 */
export function ErpNewPurchaseOrderPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: suppliers = [] } = supplierHooks.useList();
  const { data: items = [] } = itemHooks.useList();
  const createPo = createResourceHooks<ErpPurchaseOrder>("erp/purchase-orders").useCreate();

  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);

  const updateLine = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => setLines((ls) => (ls.length === 1 ? ls : ls.filter((_, idx) => idx !== i)));

  const canSubmit = supplierId !== "" && lines.every((l) => l.itemId !== "" && l.quantity !== "");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">New Purchase Order</h1>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          createPo.mutate(
            {
              supplierId: Number(supplierId),
              notes: notes || undefined,
              expectedDeliveryDate: expectedDeliveryDate || undefined,
              lineItems: lines.map((l) => ({
                itemId: Number(l.itemId),
                quantity: Number(l.quantity),
                unitCost: l.unitCost ? Number(l.unitCost) : undefined,
                notes: l.notes || undefined,
              })),
            } as never,
            {
              onSuccess: (po) => {
                toast.success("Purchase order created.");
                navigate(`/erp/${po.id}`);
              },
              onError: (err) => toast.error(extractErrorMessage(err, "Couldn't create purchase order.")),
            }
          );
        }}
      >
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <SelectField label="Supplier" required value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Select a supplier…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </SelectField>
            <TextField label="Expected Delivery Date (optional)" type="date" value={expectedDeliveryDate} onChange={(e) => setExpectedDeliveryDate(e.target.value)} />
            <TextField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">Line Items</h3>
          <div className="flex flex-col gap-3">
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-[2fr_1fr_1fr_2fr_auto] items-end gap-2 border-b border-border pb-3 last:border-0 last:pb-0">
                <SelectField label="Item" value={line.itemId} onChange={(e) => updateLine(i, { itemId: e.target.value })}>
                  <option value="">Select an item…</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.sku}
                    </option>
                  ))}
                </SelectField>
                <TextField label="Quantity" type="number" min="1" value={line.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} />
                <TextField label="Unit Cost (optional)" type="number" min="0" step="0.01" value={line.unitCost} onChange={(e) => updateLine(i, { unitCost: e.target.value })} />
                <TextField label="Notes (optional)" value={line.notes} onChange={(e) => updateLine(i, { notes: e.target.value })} />
                <button
                  type="button"
                  onClick={() => removeLine(i)}
                  disabled={lines.length === 1}
                  className="rounded-md border border-border p-2 text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Remove line"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setLines((ls) => [...ls, emptyLine()])} className="mt-3 text-sm text-primary hover:underline">
            + Add line
          </button>
        </div>

        <button
          type="submit"
          disabled={!canSubmit || createPo.isPending}
          className="w-fit rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {createPo.isPending ? "Creating…" : "Create Purchase Order"}
        </button>
      </form>
    </div>
  );
}
