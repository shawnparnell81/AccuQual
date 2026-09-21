import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { Modal } from "../modals/Modal";
import { SelectField, TextAreaField, TextField } from "../forms/Field";
import { useToast } from "../shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { DESTROY_LABEL, ITEM_TYPE_LABEL, REASON_LABEL, RELEASE_LABEL, type QuarantineDetail, type QuarantineItemType, type QuarantineReason } from "../../api/quarantine";

const isEnforced = (t: QuarantineItemType) => t === "inventory_lot" || t === "inventory_item";

// ---- Place a hold ----------------------------------------------------------------------------------------------------------------------------------

interface LotHit {
  id: number;
  sku: string;
  lotNumber: string;
  remainingQty: string;
  heldQty: string;
}
interface ItemHit {
  id: number;
  sku: string;
  description: string | null;
}

export function CreateHoldModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [itemType, setItemType] = useState<QuarantineItemType>("inventory_lot");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<{ id: number; label: string } | null>(null);
  const [label, setLabel] = useState("");
  const [quantity, setQuantity] = useState("");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState<QuarantineReason>("nonconforming_material");
  const [reason, setReason] = useState("");
  const [ncrId, setNcrId] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const lots = useQuery<LotHit[]>({ queryKey: ["quarantine", "lot-search", search], queryFn: async () => (await apiClient.get("/inventory/lots", { params: { q: search } })).data, enabled: isOpen && itemType === "inventory_lot" && !picked });
  const items = useQuery<ItemHit[]>({ queryKey: ["quarantine", "item-search"], queryFn: async () => (await apiClient.get("/inventory/items")).data, enabled: isOpen && itemType === "inventory_item" && !picked });
  const itemHits = (items.data ?? []).filter((i) => `${i.sku} ${i.description ?? ""}`.toLowerCase().includes(search.toLowerCase())).slice(0, 8);

  const create = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post("/quarantine", {
          itemType,
          itemId: picked?.id,
          itemLabel: isEnforced(itemType) ? undefined : label,
          quantity: Number(quantity),
          location: location || undefined,
          reasonCategory: category,
          reason,
          ncrId: ncrId ? Number(ncrId) : undefined,
        })
      ).data as { id: number },
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ["quarantine"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Hold placed.");
      onClose();
      navigate(`/quarantine/${r.id}`);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't place the hold.")),
  });

  const ready = Number(quantity) > 0 && reason.trim().length >= 5 && (isEnforced(itemType) ? !!picked : label.trim().length > 0);

  return (
    <Modal title="Place a hold" isOpen={isOpen} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <SelectField
          label="What is being held"
          value={itemType}
          onChange={(e) => {
            setItemType(e.target.value as QuarantineItemType);
            setPicked(null);
            setSearch("");
          }}
        >
          {(Object.keys(ITEM_TYPE_LABEL) as QuarantineItemType[]).map((t) => (
            <option key={t} value={t}>
              {ITEM_TYPE_LABEL[t]}
            </option>
          ))}
        </SelectField>

        {isEnforced(itemType) ? (
          picked ? (
            <p className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
              <span>{picked.label}</span>
              <button className="text-xs text-primary hover:underline" onClick={() => setPicked(null)}>
                Change
              </button>
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <TextField label={itemType === "inventory_lot" ? "Find a lot (lot number or SKU)" : "Find an item (SKU or description)"} value={search} onChange={(e) => setSearch(e.target.value)} />
              <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-sm">
                {itemType === "inventory_lot"
                  ? (lots.data ?? []).slice(0, 8).map((l) => (
                      <li key={l.id}>
                        <button onClick={() => setPicked({ id: l.id, label: `${l.sku} — lot ${l.lotNumber} (${Math.max(Number(l.remainingQty) - Number(l.heldQty), 0)} available)` })} className="w-full rounded px-2 py-1 text-left hover:bg-muted">
                          {l.sku} — lot {l.lotNumber} <span className="text-xs text-muted-foreground">({Math.max(Number(l.remainingQty) - Number(l.heldQty), 0)} available)</span>
                        </button>
                      </li>
                    ))
                  : itemHits.map((i) => (
                      <li key={i.id}>
                        <button onClick={() => setPicked({ id: i.id, label: `${i.sku}${i.description ? ` — ${i.description}` : ""}` })} className="w-full rounded px-2 py-1 text-left hover:bg-muted">
                          {i.sku} <span className="text-xs text-muted-foreground">{i.description}</span>
                        </button>
                      </li>
                    ))}
              </ul>
            </div>
          )
        ) : (
          <>
            <TextField label="Name or description" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Pallet 7 — Bracket 4400" />
            <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">The system can't stop this being used — the hold is a record people are expected to follow. Only inventory lots and items are enforced.</p>
          </>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Quantity on hold" type="number" min={0} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          <TextField label="Where it is" value={location} placeholder="Quarantine area" onChange={(e) => setLocation(e.target.value)} />
        </div>
        <SelectField label="Why" value={category} onChange={(e) => setCategory(e.target.value as QuarantineReason)}>
          {(Object.keys(REASON_LABEL) as QuarantineReason[]).map((r) => (
            <option key={r} value={r}>
              {REASON_LABEL[r]}
            </option>
          ))}
        </SelectField>
        <TextAreaField label="What is wrong" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        <TextField label="Linked NCR number (optional)" type="number" min={1} value={ncrId} onChange={(e) => setNcrId(e.target.value)} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Cancel
          </button>
          <button disabled={!ready || create.isPending} onClick={() => create.mutate()} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {create.isPending ? "Placing…" : "Place hold"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---- Release / destroy -----------------------------------------------------------------------------------------------------------------------------

export function ResolveModal({ record, action, isOpen, onClose }: { record: QuarantineDetail; action: "release" | "destroy"; isOpen: boolean; onClose: () => void }) {
  const labels = action === "release" ? RELEASE_LABEL : DESTROY_LABEL;
  const [disposition, setDisposition] = useState(Object.keys(labels)[0]!);
  const [quantity, setQuantity] = useState(record.quantity);
  const [notes, setNotes] = useState("");
  const queryClient = useQueryClient();
  const toast = useToast();
  const held = Number(record.quantity);

  const resolve = useMutation({
    mutationFn: async () => (await apiClient.post(`/quarantine/${record.id}/${action}`, { disposition, quantity: Number(quantity), notes })).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["quarantine"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      void queryClient.invalidateQueries({ queryKey: ["workflow-history", "quarantine", record.id] });
      toast.success(action === "release" ? "Released." : "Removed from stock.");
      setNotes("");
      onClose();
    },
    onError: (err) => toast.error(extractErrorMessage(err, "That didn't work.")),
  });

  return (
    <Modal title={action === "release" ? "Release from hold" : "Remove from stock"} isOpen={isOpen} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {action === "release" ? "The units become usable again." : "The units leave inventory through a recorded scrap or return, and can't be brought back."} You can decide part of the quantity now and the rest later. Whoever placed the hold can't decide it (an admin excepted).
        </p>
        <SelectField label="Decision" value={disposition} onChange={(e) => setDisposition(e.target.value)}>
          {Object.entries(labels).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </SelectField>
        <TextField label={`Quantity (up to ${held}${record.unit ? ` ${record.unit}` : ""})`} type="number" min={0} max={held} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <TextAreaField label="Why (required — it becomes part of the record)" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Cancel
          </button>
          <button
            disabled={resolve.isPending || notes.trim().length < 5 || !(Number(quantity) > 0 && Number(quantity) <= held)}
            onClick={() => resolve.mutate()}
            className={`rounded-md px-3 py-2 text-sm font-medium disabled:opacity-60 ${action === "destroy" ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"}`}
          >
            {resolve.isPending ? "Saving…" : action === "release" ? "Release" : "Remove from stock"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---- Move ------------------------------------------------------------------------------------------------------------------------------------------

export function MoveModal({ record, isOpen, onClose }: { record: QuarantineDetail; isOpen: boolean; onClose: () => void }) {
  const [from, setFrom] = useState(record.inventory[0]?.location ?? "");
  const [to, setTo] = useState("");
  const [quantity, setQuantity] = useState("");
  const queryClient = useQueryClient();
  const toast = useToast();
  const move = useMutation({
    mutationFn: async () => (await apiClient.post(`/quarantine/${record.id}/relocate`, { fromLocation: from, toLocation: to, quantity: Number(quantity) })).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["quarantine"] });
      void queryClient.invalidateQueries({ queryKey: ["workflow-history", "quarantine", record.id] });
      toast.success("Moved.");
      setTo("");
      setQuantity("");
      onClose();
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't move it.")),
  });
  return (
    <Modal title="Move held material" isOpen={isOpen} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <SelectField label="From" value={from} onChange={(e) => setFrom(e.target.value)}>
          {record.inventory.map((r) => (
            <option key={r.id} value={r.location}>
              {r.location} ({r.quantity})
            </option>
          ))}
        </SelectField>
        <TextField label="To" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Cage B" />
        <TextField label="Quantity" type="number" min={0} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Cancel
          </button>
          <button disabled={!from || !to.trim() || !(Number(quantity) > 0) || move.isPending} onClick={() => move.mutate()} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {move.isPending ? "Moving…" : "Move"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
