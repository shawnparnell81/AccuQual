import { ncrStepLabel } from "./opsLanguage";
import { showRecordNumber } from "./userRecordNumber";

export interface NcrSearchRow {
  id: number;
  recordNumber?: string | null;
  title: string;
  status: string;
  siteId?: number | null;
  siteName?: string | null;
}

/** Empty state filter means every state, including closed. */
export const NCR_ALL_STATES = "";

export function ncrMatchesStateFilter(status: string, stateFilter: string): boolean {
  if (!stateFilter || stateFilter === "all") return true;
  return status === stateFilter;
}

export function ncrMatchesQuery(row: NcrSearchRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const number = showRecordNumber(row.recordNumber).toLowerCase();
  const title = (row.title ?? "").toLowerCase();
  return number.includes(needle) || title.includes(needle);
}

/** Closed rows stay in the picker. The number shown is the one a person typed. */
export function ncrPickerRows(rows: readonly NcrSearchRow[], query: string): NcrSearchRow[] {
  return rows.filter((row) => ncrMatchesQuery(row, query));
}

export function ncrLinkConfirmation(row: NcrSearchRow): string {
  const number = showRecordNumber(row.recordNumber) || "NCR";
  const site = row.siteName?.trim() || "Site";
  const state = ncrStepLabel(row.status);
  return `Linked: ${number} (${site}, ${state})`;
}
