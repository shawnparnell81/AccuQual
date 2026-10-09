import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { TextField, SelectField } from "../../components/forms/Field";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import type { QuarantineItemRow } from "../Quarantine/QuarantinePage";

const DISPOSITIONS = [
  { value: "use_as_is", label: "Use as is" },
  { value: "rework", label: "Rework" },
  { value: "scrap", label: "Scrap" },
  { value: "return_to_supplier", label: "Return to supplier" },
  { value: "on_hold", label: "On Hold" },
] as const;

export const ON_HOLD_DISPOSITION = "on_hold";
export const ON_HOLD_BLOCK_MESSAGE = "This NCR is On Hold. Change the quarantine disposition off On Hold before you release or close it.";

type DispositionValue = (typeof DISPOSITIONS)[number]["value"];

/** Completed lines store the resolution word (reworked, scrapped). The dropdown still uses the choice the user made. */
const DISPOSITION_ALIASES: Record<string, DispositionValue> = {
  use_as_is: "use_as_is",
  rework: "rework",
  reworked: "rework",
  scrap: "scrap",
  scrapped: "scrap",
  return_to_supplier: "return_to_supplier",
  returned_to_supplier: "return_to_supplier",
  on_hold: "on_hold",
};

function dispositionFromRows(rows: QuarantineItemRow[]): DispositionValue | null {
  const mapped = rows
    .map((row) => (row.disposition ? DISPOSITION_ALIASES[row.disposition] : undefined))
    .filter((value): value is DispositionValue => value != null);
  if (mapped.includes(ON_HOLD_DISPOSITION)) return ON_HOLD_DISPOSITION;
  return mapped[0] ?? null;
}

/**
 * Quarantine is started here, on the NCR. Each row becomes a quarantined item.
 * Completing the disposition releases every item still held for this NCR.
 */
export function NcrQuarantineSection({ ncrId, canEdit, onHoldChange }: { ncrId: number; canEdit: boolean; onHoldChange?: (held: boolean) => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [partNumber, setPartNumber] = useState("");
  const [quantity, setQuantity] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [picked, setPicked] = useState<{ ncrId: number; value: DispositionValue } | null>(null);
  const [concession, setConcession] = useState<"" | "with" | "none">("");
  const previousDisposition = useRef<DispositionValue>("use_as_is");

  const items = useQuery<QuarantineItemRow[]>({
    queryKey: ["ncr", ncrId, "quarantine-items"],
    queryFn: async () => (await apiClient.get<QuarantineItemRow[]>(`/ncr/${ncrId}/quarantine-items`)).data,
  });
  const rows = items.data ?? [];
  const serverDisposition = dispositionFromRows(rows);
  const disposition = (picked?.ncrId === ncrId ? picked.value : null) ?? serverDisposition ?? "use_as_is";
  const hasOpen = rows.some((row) => row.status === "quarantined");
  const held = disposition === ON_HOLD_DISPOSITION || rows.some((row) => row.disposition === ON_HOLD_DISPOSITION);
  const showSerial = rows.some((row) => !!row.serialNumber) || canEdit;
  const showDisposition = rows.some((row) => !!row.dispositionLabel);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["ncr", ncrId, "quarantine-items"] });
    void queryClient.invalidateQueries({ queryKey: ["quarantine", "items"] });
  }

  const add = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post(`/ncr/${ncrId}/quarantine-items`, {
          partNumber,
          quantity: Number(quantity),
          ...(serialNumber.trim() ? { serialNumber: serialNumber.trim() } : {}),
        })
      ).data,
    onSuccess: () => {
      setPartNumber("");
      setQuantity("");
      setSerialNumber("");
      refresh();
      toast.success("Item quarantined.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't quarantine that item.")),
  });

  const saveDisposition = useMutation({
    mutationFn: async (next: DispositionValue) => (await apiClient.post(`/ncr/${ncrId}/disposition`, { disposition: next, release: false })).data,
    onSuccess: (data: { items?: unknown[] }) => {
      if (!data?.items?.length) {
        setPicked(null);
        toast.error("Those items are already released. Add a quarantined item before changing the disposition.");
        return;
      }
      refresh();
    },
    onError: (err) => {
      setPicked({ ncrId, value: previousDisposition.current });
      toast.error(extractErrorMessage(err, "Couldn't save that disposition."));
    },
  });

  const complete = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post(`/ncr/${ncrId}/disposition`, {
          disposition,
          ...(disposition === "use_as_is" && concession ? { concession } : {}),
        })
      ).data,
    onSuccess: () => {
      refresh();
      toast.success("Disposition completed. Those items are no longer on the active quarantine list.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't complete the disposition.")),
  });

  useEffect(() => {
    onHoldChange?.(held);
  }, [held, onHoldChange]);

  function chooseDisposition(next: DispositionValue) {
    if (next === disposition) return;
    previousDisposition.current = disposition;
    setPicked({ ncrId, value: next });
    if (next !== "use_as_is") setConcession("");
    saveDisposition.mutate(next);
  }

  return (
    <section className="no-print flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-medium">Quarantined items</h2>
        <p className="text-xs text-muted-foreground">Add every part held for this NCR. When you complete the disposition, they leave the active list and stay in Released.</p>
      </div>

      {items.isLoading && <p className="text-sm text-muted-foreground">Loading quarantined items…</p>}
      {items.isError && <p className="text-sm text-destructive">Couldn't load quarantined items for this NCR.</p>}
      {!items.isLoading && !items.isError && rows.length === 0 && <p className="text-sm text-muted-foreground">No quarantined items on this NCR yet.</p>}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-medium">Part #</th>
                <th className="py-1 pr-3 font-medium">Qty</th>
                {showSerial && <th className="py-1 pr-3 font-medium">S/N</th>}
                {showDisposition && <th className="py-1 pr-3 font-medium">Disposition</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="py-1.5 pr-3">{row.partNumber}</td>
                  <td className="py-1.5 pr-3">{Number(row.quantity)}</td>
                  {showSerial && <td className="py-1.5 pr-3">{row.serialNumber ?? ""}</td>}
                  {showDisposition && <td className="py-1.5 pr-3">{row.dispositionLabel ?? ""}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <form
          className="grid gap-3 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <TextField label="Part #" value={partNumber} onChange={(e) => setPartNumber(e.target.value)} required />
          <TextField label="Qty" type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
          <TextField label="S/N (optional)" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
          <div className="flex items-end">
            <button type="submit" disabled={add.isPending} className="w-full rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60">
              {add.isPending ? "Adding…" : "Add item"}
            </button>
          </div>
        </form>
      )}

      {canEdit && !items.isLoading && (
        <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <div className="min-w-[14rem]">
            <SelectField label="Disposition" value={disposition} onChange={(e) => chooseDisposition(e.target.value as DispositionValue)}>
              {DISPOSITIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
          </div>
          {disposition === "use_as_is" && (
            <fieldset className="flex flex-col gap-1 pb-1">
              <legend className="text-xs text-muted-foreground">Concession</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={concession === "with"} onChange={() => setConcession((current) => (current === "with" ? "" : "with"))} />
                with concession
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={concession === "none"} onChange={() => setConcession((current) => (current === "none" ? "" : "none"))} />
                no concession
              </label>
            </fieldset>
          )}
          <button
            type="button"
            disabled={complete.isPending || saveDisposition.isPending || !hasOpen || held}
            onClick={() => {
              if (held) {
                toast.error(ON_HOLD_BLOCK_MESSAGE);
                return;
              }
              complete.mutate();
            }}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {complete.isPending ? "Releasing…" : "Complete disposition"}
          </button>
        </div>
      )}
      {held && <p className="text-sm text-destructive">{ON_HOLD_BLOCK_MESSAGE}</p>}
    </section>
  );
}

/** Rows collected on the create form, posted after the NCR exists. Blank rows are skipped. */
export function QuarantineDraftFields({
  rows,
  onChange,
}: {
  rows: { partNumber: string; quantity: string; serialNumber: string }[];
  onChange: (rows: { partNumber: string; quantity: string; serialNumber: string }[]) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">Quarantined items</p>
      <p className="text-xs text-muted-foreground">Optional. Part # and quantity are enough; add a serial number only when the part has one.</p>
      {rows.map((row, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-3">
          <TextField label={index === 0 ? "Part #" : ""} value={row.partNumber} onChange={(e) => onChange(rows.map((item, i) => (i === index ? { ...item, partNumber: e.target.value } : item)))} />
          <TextField label={index === 0 ? "Qty" : ""} type="number" min="0" step="any" value={row.quantity} onChange={(e) => onChange(rows.map((item, i) => (i === index ? { ...item, quantity: e.target.value } : item)))} />
          <TextField label={index === 0 ? "S/N (optional)" : ""} value={row.serialNumber} onChange={(e) => onChange(rows.map((item, i) => (i === index ? { ...item, serialNumber: e.target.value } : item)))} />
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, { partNumber: "", quantity: "", serialNumber: "" }])}
        className="w-fit text-sm text-primary hover:underline"
      >
        Add another item
      </button>
    </div>
  );
}

export async function saveDraftQuarantineItems(
  ncrId: number,
  rows: { partNumber: string; quantity: string; serialNumber: string }[],
) {
  const filled = rows.filter((row) => row.partNumber.trim() || row.quantity.trim() || row.serialNumber.trim());
  for (const row of filled) {
    await apiClient.post(`/ncr/${ncrId}/quarantine-items`, {
      partNumber: row.partNumber.trim(),
      quantity: Number(row.quantity),
      ...(row.serialNumber.trim() ? { serialNumber: row.serialNumber.trim() } : {}),
    });
  }
}
