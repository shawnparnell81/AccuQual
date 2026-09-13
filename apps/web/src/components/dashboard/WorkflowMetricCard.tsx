import { Link } from "react-router-dom";
import clsx from "clsx";

type Bucket = "muted" | "info" | "warning" | "success" | "destructive";

const BUCKET_CLASSES: Record<Bucket, string> = {
  muted: "text-foreground",
  info: "text-info",
  warning: "text-warning",
  success: "text-success",
  destructive: "text-destructive",
};

interface WorkflowMetricCardProps {
  label: string;
  value: number | string;
  /** Real-record-count-driven, not a per-module magic threshold — pass "destructive" for anything overdue/failed, "warning" for pending/awaiting, "success" for healthy, "muted" for a plain count. */
  bucket?: Bucket;
  /** Deep link, per the brief's "clickable -> deep links to filtered module list" — scoped to the module's real list page (see the summary on why per-status query-param filtering wasn't added to 6 list pages in this pass). */
  to?: string;
}

/** The one shared metric tile every dashboard section uses — a plain count, color-coded by what it means, optionally linking to where the underlying records actually live. */
export function WorkflowMetricCard({ label, value, bucket = "muted", to }: WorkflowMetricCardProps) {
  const content = (
    <div className={clsx("rounded-lg border border-border bg-card p-4 transition-colors", to && "hover:border-primary/40")}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={clsx("mt-1 text-2xl font-semibold", BUCKET_CLASSES[bucket])}>{value}</p>
    </div>
  );
  return to ? <Link to={to}>{content}</Link> : content;
}
