import { Link } from "react-router-dom";
import { ListChecks } from "lucide-react";
import { StatusBadge } from "../tables/StatusBadge";
import { useCalendarItems, type CalendarModule } from "../../hooks/useCalendarItems";

const MODULE_LABELS: Record<CalendarModule, string> = {
  ncr: "NCR",
  capa: "CAPA",
  audit: "Audit",
  training: "Training",
  document: "Document",
  crar: "CRAR",
};

/**
 * Every due-date-like field this app has (NCR/CAPA's new "Due date",
 * Audit's "Scheduled date", ...) is entered through a plain `type="date"`
 * input and serialized as UTC midnight so the calendar day survives
 * regardless of viewer timezone (see calendarGrid.ts's utcDayKey for the
 * fuller explanation) — formatting with `timeZone: "UTC"` reads that same
 * day back, instead of `toLocaleDateString`'s default local-timezone
 * reading, which shifts it a day earlier for anyone west of UTC.
 */
function formatDueDate(dueDate: string | null): string {
  if (!dueDate) return "No due date";
  return `Due ${new Date(dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
}

/**
 * "What needs my attention" — pending doc reviews, training sign-offs, open
 * NCRs/CAPAs assigned to me, and audits I'm running, sorted soonest-due
 * first (GET /calendar already sorts; terminal/completed rows are filtered
 * back out here since this list is only ever "still needs action" — the
 * User Dashboard's stats are the ones that use the full, unfiltered set).
 */
export function WorkflowInbox() {
  const { items, isLoading } = useCalendarItems();
  const pending = items.filter((item) => !item.isTerminal);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
        <ListChecks size={15} className="text-primary" /> My Workflow Inbox
      </h3>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : pending.length === 0 ? (
        <p className="text-sm text-muted-foreground">You're all caught up — nothing needs your attention right now.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {pending.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0">
              <div className="min-w-0 flex-1">
                <Link to={item.link} className="font-medium hover:underline">
                  {item.title}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {MODULE_LABELS[item.module]} · {formatDueDate(item.dueDate)}
                </p>
              </div>
              <StatusBadge value={item.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
