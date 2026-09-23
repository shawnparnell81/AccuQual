import { ListChecks } from "lucide-react";
import { useCalendarItems } from "../../hooks/useCalendarItems";
import { CalendarItemList } from "../shared/CalendarItemList";

/**
 * "What needs my attention" — pending doc reviews, training sign-offs, open
 * NCRs/CAPAs assigned to me, and audits I'm running, sorted soonest-due
 * first (GET /calendar already sorts; terminal/completed rows are filtered
 * back out here since this list is only ever "still needs action" — the
 * User Dashboard's stats are the ones that use the full, unfiltered set).
 * Rendered by the shared CalendarItemList — Worker Runtime's per-person
 * activity view renders the exact same aggregated items the same way.
 */
export function WorkflowInbox({ title = "Assigned to you", emptyMessage = "Nothing needs you right now." }: { title?: string; emptyMessage?: string }) {
  const { items, isLoading } = useCalendarItems();
  const pending = items.filter((item) => !item.isTerminal);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
        <ListChecks size={15} className="text-primary" /> {title}
      </h3>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading your list…</p> : <CalendarItemList items={pending} emptyMessage={emptyMessage} />}
    </div>
  );
}
