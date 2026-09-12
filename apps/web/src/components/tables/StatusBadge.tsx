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
const BUCKET_BY_STATUS: Record<string, "muted" | "info" | "warning" | "success" | "destructive"> = {
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

  open: "warning",
  medium: "warning",
  high: "warning",
  expiring_soon: "warning",
  overdue: "warning",

  approved: "success",
  completed: "success",
  implemented: "success",
  resolved: "success",
  active: "success",
  closed: "success",
  released: "success",

  rejected: "destructive",
  disqualified: "destructive",
  failed: "destructive",
  critical: "destructive",
  expired: "destructive",
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
