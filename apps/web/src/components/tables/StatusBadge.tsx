import clsx from "clsx";

/**
 * Token-driven (bg-{token}/15 text-{token}, same soft-badge convention as
 * "bg-primary/10 text-primary" elsewhere in the app), not literal Tailwind
 * palette classes — this used to be bg-amber-100/text-amber-800 etc., which
 * read as a near-invisible pale pastel-on-white pill once the neon dark
 * theme shipped. That mismatch is exactly why Calibration/Documents/Training
 * each grew their own bespoke inline-hex status pill instead of reusing this
 * component; fixing it here and pointing them at it removes that
 * duplication instead of leaving a fourth copy behind.
 *
 * Five buckets, not one per status value: this app's token palette has
 * muted/info/warning/success/destructive, not a distinct hue per QMS status
 * word — "verifying" and "in_progress" both read as "in progress toward a
 * decision", so both map to `info`, same idea for the others below.
 */
export type StatusBucket = "muted" | "info" | "warning" | "success" | "destructive";

/** Exported so cross-module views (the workflow dashboards' state distribution chart) bucket a status exactly the same way this badge colors it, instead of a second mapping that could drift out of sync. */
export const BUCKET_BY_STATUS: Record<string, StatusBucket> = {
  draft: "muted",
  scheduled: "muted",
  submitted: "muted",
  low: "muted",
  assigned: "muted",
  pending: "muted",
  obsolete: "muted", // retired/superseded, not a problem state — distinct from "expired" below

  contained: "info",
  investigating: "info",
  in_progress: "info",
  under_review: "info",
  in_review: "info",
  verifying: "info",
  corrective_action: "info",
  disposed: "info", // DI: awaiting close, one step past investigating

  open: "warning",
  medium: "warning",
  high: "warning",
  minor: "warning", // Audit finding severity — same weight as NCR's "medium"
  major: "warning", // Audit finding severity — same weight as NCR's "high"
  expiring_soon: "warning",
  overdue: "warning",
  probation: "warning", // Supplier: conditional, not yet a problem but not fully clear either
  suspended: "warning", // Supplier: paused, not yet the terminal disqualified — see Phase 6's supplier.controller.ts

  approved: "success",
  completed: "success",
  implemented: "success",
  resolved: "success",
  active: "success",
  closed: "success",
  released: "success",
  in_stock: "success", // Inventory: healthy stock level
  ok: "success", // System Health checks (Phase 10) — "critical" below already covers that same check's worst case

  rejected: "destructive",
  disqualified: "destructive",
  failed: "destructive",
  critical: "destructive",
  expired: "destructive",

  // Inventory-specific states not covered by the buckets above.
  below_min: "warning",
  overstock: "warning",
  reorder_pending: "info",
  on_order: "info",
  inactive: "muted",
  // Inventory lot lifecycle (inventoryLots.ts's own status comment) — active/
  // expired already covered above; these three were missing and fell back to
  // "muted" for every consumed/scrapped/returned lot.
  consumed: "muted",
  scrapped: "destructive",
  returned: "warning",

  // ERP purchase order states.
  sent: "info",
  partially_received: "info",
  received: "success",
  cancelled: "destructive",

  // RMA-specific states not covered above (draft/closed already are).
  submitted_to_supplier: "info",
  approved_by_supplier: "info",
  in_transit: "info",
  received_by_supplier: "info",

  // Warranty-specific states not covered above (approved/rejected/closed already are).
  new: "muted",
  inspection: "info",
  supplier_review: "info",
  replaced: "success",
  repaired: "success",

  // Phase 4 AI Enablement — per-tenant AI mode on the Platform Admin AI Overview panel.
  live: "success",
  degraded: "warning",
  disabled: "muted",
  stub: "info", // key configured (platform or tenant), but no real attempt has landed yet this window

  // Supplier Portal review states not covered above.
  accepted: "success",

  // System Health checks (Phase 10) — "critical" above already covers that
  // status literally; this is the literal "warning" status string itself,
  // distinct from every other status word that merely buckets INTO warning.
  warning: "warning",

  // ai_suggestions' own per-attempt status (ai.guardrails.ts's classifyOutput) —
  // "ok"/"stub"/"rejected"/"accepted" above already cover 4 of these; the
  // two real failure states didn't have an entry yet and were falling back
  // to the generic "muted" bucket, underselling a real provider failure.
  malformed: "destructive",
  error: "destructive",
};

const BUCKET_CLASSES: Record<string, string> = {
  muted: "bg-muted text-muted-foreground",
  info: "bg-info/15 text-info",
  warning: "bg-warning/15 text-warning",
  success: "bg-success/15 text-success",
  destructive: "bg-destructive/15 text-destructive",
};

export function StatusBadge({ value, label }: { value: string | null | undefined; label?: string }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const bucket = BUCKET_BY_STATUS[value] ?? "muted";
  return (
    <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium capitalize", BUCKET_CLASSES[bucket])}>
      {label ?? value.replace(/_/g, " ")}
    </span>
  );
}
