/**
 * Phase 11 — a shared date-formatting convention. Before this, ~51 files
 * called `toLocaleDateString()`/`toLocaleString()` directly with no shared
 * options, producing genuinely different formats across the app (bare
 * digit-only "9/16/2026" on most list pages vs. a full locale timestamp on
 * history/audit panels) with no single source of truth. Scoped here to the
 * highest-leverage call sites — the shared history/audit-trail components
 * every module's detail page already reuses (see WorkflowHistoryItem.tsx,
 * EntityAuditTrailPanel.tsx) — rather than rewriting all 51 files, since
 * fixing the shared components alone reaches 20+ modules at once.
 */
export function formatDate(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
