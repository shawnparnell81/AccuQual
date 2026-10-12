/**
 * Pure due-date math shared by the Approved Sources list, the dashboard tiles, and the
 * daily scheduler sweep — one place computes "due soon" / "overdue" so the three never
 * disagree. Dates are the module's existing convention: plain "YYYY-MM-DD" text, not
 * timestamps (see insp_approved_sources.next_due_date).
 */

export type DueStatus = "due_soon" | "overdue" | null;

/** today defaults to the real current date; a caller may pass one for deterministic tests. */
export function dueStatusFor(nextDueDate: string | null | undefined, today: string = isoToday()): DueStatus {
  if (!nextDueDate) return null;
  if (nextDueDate < today) return "overdue";
  const in30 = addDays(today, 30);
  if (nextDueDate <= in30) return "due_soon";
  return null;
}

export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Same convention as fai-inspection.service.ts's own (unexported) addMonths, for the random-pull exclusion cutoff. */
export function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export const DUE_STATUS_LABEL: Record<Exclude<DueStatus, null>, string> = {
  due_soon: "Due in 30 days",
  overdue: "Overdue",
};
