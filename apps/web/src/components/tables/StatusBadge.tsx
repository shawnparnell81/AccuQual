import clsx from "clsx";

const COLOR_BY_STATUS: Record<string, string> = {
  open: "bg-amber-100 text-amber-800",
  contained: "bg-blue-100 text-blue-800",
  investigating: "bg-blue-100 text-blue-800",
  in_progress: "bg-blue-100 text-blue-800",
  verifying: "bg-purple-100 text-purple-800",
  corrective_action: "bg-purple-100 text-purple-800",
  scheduled: "bg-slate-100 text-slate-800",
  draft: "bg-slate-100 text-slate-800",
  submitted: "bg-slate-100 text-slate-800",
  under_review: "bg-blue-100 text-blue-800",
  in_review: "bg-blue-100 text-blue-800",
  approved: "bg-emerald-100 text-emerald-800",
  completed: "bg-emerald-100 text-emerald-800",
  implemented: "bg-emerald-100 text-emerald-800",
  resolved: "bg-emerald-100 text-emerald-800",
  active: "bg-emerald-100 text-emerald-800",
  closed: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-800",
  disqualified: "bg-rose-100 text-rose-800",
  failed: "bg-rose-100 text-rose-800",
  critical: "bg-rose-100 text-rose-800",
  high: "bg-orange-100 text-orange-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-slate-100 text-slate-800",
};

export function StatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium capitalize", COLOR_BY_STATUS[value] ?? "bg-slate-100 text-slate-800")}>
      {value.replace(/_/g, " ")}
    </span>
  );
}
