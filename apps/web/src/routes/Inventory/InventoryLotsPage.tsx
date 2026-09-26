import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { DataTable } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { SelectField, TextField } from "../../components/forms/Field";
import type { InventoryLotSearchResult } from "../../api/types";

const lotHooks = createResourceHooks<InventoryLotSearchResult>("inventory/lots");
const STATUSES = ["active", "consumed", "scrapped", "returned", "expired"] as const;

/**
 * Company-wide lot/serial visibility — the real gap Phase 8 left open: the
 * per-lot ledger (inventory_lots) and the full receiving→supplier→
 * inspection traceability chain (GET /inventory/lots/:id/trace) both
 * existed already, but only reachable from an item's own detail page, one
 * item at a time. A recall or customer complaint almost always starts from
 * a lot number, a serial number, or a SKU — not from browsing the item
 * roster first — so this searches across every item's lots at once and
 * hands off to InventoryLotDetailPage for the full chain.
 */
export function InventoryLotsPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (q) p.q = q;
    if (status) p.status = status;
    return p;
  }, [q, status]);

  const { data: rows = [], isLoading, isError } = lotHooks.useList(params);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Lot / Serial Visibility</h1>
      </div>

      <div className="grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-3">
        <TextField label="Search (lot #, serial #, or SKU)" value={q} onChange={(e) => setQ(e.target.value)} />
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </SelectField>
      </div>

      <DataTable<InventoryLotSearchResult>
        columns={[
          { header: "Lot #", accessor: (l) => l.lotNumber },
          { header: "Serial #", accessor: (l) => l.serialNumber ?? "—" },
          { header: "SKU", accessor: (l) => l.sku },
          { header: "Description", accessor: (l) => l.description ?? "—" },
          { header: "Received", accessor: (l) => l.receivedQty, className: "tabular-nums" },
          { header: "Remaining", accessor: (l) => l.remainingQty, className: "tabular-nums" },
          { header: "On hold", accessor: (l) => (Number(l.heldQty) > 0 ? <span className="font-semibold text-destructive">{l.heldQty}</span> : "—"), className: "tabular-nums" },
          { header: "Expires", accessor: (l) => (l.expirationDate ? new Date(l.expirationDate).toLocaleDateString() : "—") },
          { header: "Status", accessor: (l) => <StatusBadge value={l.status} /> },
        ]}
        rows={rows}
        rowKey={(l) => l.id}
        isLoading={isLoading}
        isError={isError}
        onRowClick={(l) => navigate(`/inventory/lots/${l.id}`)}
        emptyMessage={q || status ? "No lots match this search." : "No tracked lots yet — a real one is created the moment an item is received with a lot number on a Purchase Order's Receiving Document."}
      />
    </div>
  );
}
