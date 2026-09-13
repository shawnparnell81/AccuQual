import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { StatusBadge } from "../tables/StatusBadge";
import type { OverdueItem } from "../../hooks/useWorkflowDashboardData";

const MODULE_LABELS: Record<OverdueItem["module"], string> = {
  calibration: "Calibration",
  documents: "Document",
  training: "Training",
  audit: "Audit",
};

/**
 * Cross-module overdue list — only from modules with a real, stored due/
 * expiration date to sort by (Calibration's nextDueAt, Documents'
 * expirationDate, Training's dueAt computed against "today" client-side —
 * see lib/workflowMetrics.ts — and Audit's scheduledAt). NCR, CAPA, and
 * Supplier are correctly absent: none of those tables has a due-date field
 * at all (see the Audit Trail Dictionary's metadata gaps), so there is
 * nothing honest to compute "overdue" from for them.
 */
export function WorkflowOverdueList({ items, limit }: { items: OverdueItem[]; limit?: number }) {
  const shown = limit ? items.slice(0, limit) : items;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
        <AlertTriangle size={15} className="text-destructive" /> Overdue Across Modules
      </h3>
      <ul className="flex flex-col gap-2 text-sm">
        {shown.length === 0 && <li className="text-muted-foreground">Nothing overdue right now.</li>}
        {shown.map((item, i) => (
          <li key={`${item.module}-${i}`} className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0">
            <div className="min-w-0 flex-1">
              <Link to={item.link} className="font-medium hover:underline">
                {item.label}
              </Link>
              <p className="truncate text-xs text-muted-foreground">{item.detail}</p>
            </div>
            <div className="flex flex-none flex-col items-end gap-0.5">
              <StatusBadge value="overdue" label={MODULE_LABELS[item.module]} />
              <span className="text-xs text-destructive">{item.daysOverdue}d overdue</span>
            </div>
          </li>
        ))}
      </ul>
      {limit && items.length > limit && <p className="mt-2 text-xs text-muted-foreground">+{items.length - limit} more</p>}
    </div>
  );
}
