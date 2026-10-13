import type { SearchResult } from "../api/types";
import type { FaiScanResponse } from "../api/faiInspection";

/** One line in the Scan to find results: a record from the global search, or an FAI & AQL plan or record. */
export interface ScanRow {
  key: string;
  label: string;
  detail: string;
  path: string;
}

/**
 * What Scan to find does with a code. A sample tag opens its FAI record with that sample highlighted. Otherwise the FAI & AQL
 * plans and records for the part come first (newest first, as the server sent them), then the rest of the search. Exactly one
 * match opens straight away; anything else is a list to choose from.
 */
export function resolveScan(fai: FaiScanResponse | null, general: SearchResult[]): { open: string } | { rows: ScanRow[] } {
  if (fai?.sample) return { open: fai.sample.path };
  const rows: ScanRow[] = [
    ...(fai?.results ?? []).map((item): ScanRow => ({ key: `fai-${item.type}-${item.id}`, label: item.label, detail: [item.type, item.detail].filter(Boolean).join(" · "), path: item.path })),
    ...general.map((result): ScanRow => ({ key: `${result.type}-${result.id}`, label: result.label, detail: result.type, path: result.path })),
  ];
  return rows.length === 1 ? { open: rows[0]!.path } : { rows };
}
