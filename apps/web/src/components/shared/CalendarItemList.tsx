import { Link } from "react-router-dom";
import { StatusBadge } from "../tables/StatusBadge";
import type { CalendarItem, CalendarModule } from "../../hooks/useCalendarItems";

const MODULE_LABELS: Record<CalendarModule, string> = {
  ncr: "NCR",
  capa: "CAPA",
  audit: "Audit",
  training: "Training",
  document: "Document",
  crar: "CRAR",
};

/**
 * Same formatting the User Dashboard's Workflow Inbox uses: every due-date
 * field in this app is a plain `type="date"` input serialized as UTC
 * midnight (see calendarGrid.ts's utcDayKey), so reading it back with
 * `timeZone: "UTC"` avoids `toLocaleDateString`'s default local-timezone
 * shift landing a day early for anyone west of UTC.
 */
function formatDueDate(dueDate: string | null): string {
  if (!dueDate) return "No due date";
  return `Due ${new Date(dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
}

/**
 * A plain list of `CalendarItem`s (title, module, due date, status) with a
 * link into the real record — extracted from the Workflow Inbox so Worker
 * Runtime's "what is this person currently assigned to" view renders the
 * same aggregated items the same way, instead of a second copy of this
 * markup with its own formatting quirks.
 */
export function CalendarItemList({ items, emptyMessage = "Nothing here." }: { items: CalendarItem[]; emptyMessage?: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {items.map((item) => (
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
  );
}
