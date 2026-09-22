import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { QrLabel } from "../../components/shared/QrLabel";
import type { InventoryLotTraceability } from "../../api/types";

function useLotTrace(lotId: number | undefined) {
  return useQuery<InventoryLotTraceability>({
    queryKey: ["inventory/lots/trace", lotId],
    queryFn: async () => (await apiClient.get(`/inventory/lots/${lotId}/trace`)).data,
    enabled: lotId !== undefined,
  });
}

/**
 * A printable lot label — QR code (the lot number, same value the "Scan to
 * find" dialog looks up) plus the identifying fields a person reads by eye.
 * No new backend endpoint: reuses the same trace fetch
 * InventoryLotDetailPage.tsx already makes.
 *
 * @page size below is a placeholder — a common small industrial label size
 * (4in x 2in), not yet confirmed against the real printer/label stock this
 * gets printed on. Change the one `@page` rule once that's known; nothing
 * else here depends on the exact size.
 */
export function LotLabelPrint() {
  const { id } = useParams<{ id: string }>();
  const lotId = id ? Number(id) : undefined;
  const { data, isLoading, isError } = useLotTrace(lotId);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (isError || !data) return <div className="p-6 text-sm text-destructive">Couldn't load this lot.</div>;

  const { lot, item } = data;

  return (
    <div className="label-scope">
      <style>{`
        @media print {
          @page { size: 4in 2in; margin: 0.15in; }
          body * { visibility: hidden; }
          .label-scope, .label-scope * { visibility: visible; }
          .label-scope { position: fixed; top: 0; left: 0; }
        }
        .label-scope { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; }
      `}</style>
      <div className="flex items-center gap-3 border border-border p-3" style={{ width: "4in" }}>
        <QrLabel value={lot.lotNumber} size={90} />
        <div className="min-w-0 flex-1 text-sm leading-tight">
          <p className="truncate text-base font-semibold">{lot.lotNumber}</p>
          <p className="truncate">{item.sku}</p>
          {item.description && <p className="truncate text-xs">{item.description}</p>}
          {lot.serialNumber && <p className="text-xs">S/N {lot.serialNumber}</p>}
          <p className="text-xs">Qty: {lot.remainingQty}</p>
        </div>
      </div>
      <button
        onClick={() => window.print()}
        className="mt-4 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground print:hidden"
      >
        Print label
      </button>
    </div>
  );
}
