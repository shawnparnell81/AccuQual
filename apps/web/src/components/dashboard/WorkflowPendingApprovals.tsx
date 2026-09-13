import { useState } from "react";
import { Link } from "react-router-dom";
import { Clock } from "lucide-react";
import { StatusBadge } from "../tables/StatusBadge";
import type { PendingItem } from "../../hooks/useWorkflowDashboardData";

const MODULE_LABELS: Record<PendingItem["module"], string> = {
  documents: "Document",
  capa: "CAPA",
  di: "DI",
};

/**
 * Cross-module "awaiting a decision" list. Deliberately narrower than the
 * brief's per-module wishlist (Calibration/Training/Audit approval, Supplier
 * pending-approval, NCR/CAPA closure summaries all appear in the brief but
 * none of those states exist in the real schema — see the Rules/Outputs/
 * Audit Trail Dictionaries) — only Documents' "in_review" and CAPA's
 * "verifying" are real, so those are the only two shown here. Renamed from
 * "approvals" to "pending decisions" for the same reason: CAPA's step is a
 * verification, not a formal approval, and calling it one would overstate
 * what the app actually enforces.
 */
export function WorkflowPendingApprovals({ items }: { items: PendingItem[] }) {
  const modules = Array.from(new Set(items.map((i) => i.module)));
  const [filter, setFilter] = useState<PendingItem["module"] | "all">("all");
  const shown = filter === "all" ? items : items.filter((i) => i.module === filter);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Clock size={15} className="text-info" /> Awaiting a Decision
        </h3>
        {modules.length > 1 && (
          <select value={filter} onChange={(e) => setFilter(e.target.value as PendingItem["module"] | "all")} className="rounded-md border border-border bg-background px-2 py-1 text-xs">
            <option value="all">All modules</option>
            {modules.map((m) => (
              <option key={m} value={m}>
                {MODULE_LABELS[m]}
              </option>
            ))}
          </select>
        )}
      </div>
      <ul className="flex flex-col gap-2 text-sm">
        {shown.length === 0 && <li className="text-muted-foreground">Nothing waiting on a decision.</li>}
        {shown.map((item, i) => (
          <li key={`${item.module}-${i}`} className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0">
            <div className="min-w-0 flex-1">
              <Link to={item.link} className="font-medium hover:underline">
                {item.label}
              </Link>
              <p className="truncate text-xs text-muted-foreground">{item.detail}</p>
            </div>
            <StatusBadge value="in_review" label={MODULE_LABELS[item.module]} />
          </li>
        ))}
      </ul>
    </div>
  );
}
