import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import clsx from "clsx";
import { useCalendarItems, type CalendarItem } from "../../hooks/useCalendarItems";
import { buildMonthGrid, groupItemsByDay, dayKey } from "../../lib/calendarGrid";
import { StatusBadge, BUCKET_BY_STATUS, BUCKET_CLASSES, type StatusBucket } from "../tables/StatusBadge";

const MODULE_LABELS: Record<CalendarItem["module"], string> = {
  ncr: "NCR",
  capa: "CAPA",
  audit: "Audit",
  training: "Training",
  document: "Document",
  crar: "CRAR",
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Most attention-grabbing first — a day with any overdue item shows red
// regardless of what else is due that same day.
const BUCKET_PRIORITY: StatusBucket[] = ["destructive", "warning", "info", "muted", "success"];

function worstBucket(items: CalendarItem[]): StatusBucket {
  const buckets = new Set(items.map((item) => BUCKET_BY_STATUS[item.status] ?? "muted"));
  return BUCKET_PRIORITY.find((b) => buckets.has(b)) ?? "muted";
}

/**
 * A real month grid — the app had nothing like this before (Dashboard's
 * "Audit Calendar" widget is just a sorted list). Fed by the same
 * GET /calendar the Workflow Inbox uses, so a day's color/count reflects
 * real NCR/CAPA/Audit/Training/Document/CRAR due dates, not a separate
 * data source. `compact` renders smaller for the Home page embed; the full
 * page at /calendar uses the default size.
 */
export function MonthCalendar({ compact = false }: { compact?: boolean }) {
  const { items } = useCalendarItems();
  const [cursor, setCursor] = useState(() => new Date());
  // The selected CELL's own Date object, not just its "YYYY-MM-DD" key —
  // re-parsing that key with `new Date(key)` reads it as UTC midnight per
  // the ES spec, which `toLocaleDateString()` then renders a day early in
  // any timezone behind UTC. Keeping the already-correct local Date from
  // the grid cell avoids that entirely.
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const grid = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const byDay = useMemo(() => groupItemsByDay(items), [items]);
  const todayKey = useMemo(() => dayKey(new Date()), []);

  const selectedKey = selectedDate ? dayKey(selectedDate) : null;
  const selected = selectedKey ? (byDay.get(selectedKey) ?? []) : [];

  function goToMonth(delta: number) {
    setCursor(new Date(year, month + delta, 1));
    setSelectedDate(null);
  }

  return (
    <div className={clsx("rounded-lg border border-border bg-card", compact ? "p-3" : "p-4")}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className={clsx("flex items-center gap-2 font-medium", compact ? "text-sm" : "text-base")}>
          <CalendarDays size={compact ? 14 : 16} className="text-primary" />
          {cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </h3>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => goToMonth(-1)} aria-label="Previous month" className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              setCursor(new Date());
              setSelectedDate(null);
            }}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            Today
          </button>
          <button type="button" onClick={() => goToMonth(1)} aria-label="Next month" className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {grid.map((cell) => {
          const dayItems = byDay.get(cell.key) ?? [];
          const isSelected = selectedKey === cell.key;
          return (
            <button
              key={cell.key}
              type="button"
              onClick={() => setSelectedDate(isSelected ? null : cell.date)}
              className={clsx(
                "flex flex-col items-center justify-start gap-1 rounded-md border text-left",
                compact ? "min-h-[2.5rem] p-1" : "min-h-[3.5rem] p-1.5",
                cell.isCurrentMonth ? "border-transparent" : "border-transparent opacity-40",
                cell.key === todayKey && "ring-1 ring-primary",
                isSelected ? "bg-muted" : "hover:bg-muted/60"
              )}
            >
              <span className="text-xs">{cell.date.getDate()}</span>
              {dayItems.length > 0 && (
                <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", BUCKET_CLASSES[worstBucket(dayItems)])}>{dayItems.length}</span>
              )}
            </button>
          );
        })}
      </div>

      {selectedDate && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            {selectedDate.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
          </p>
          {selected.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing due this day.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {selected.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3">
                  <Link to={item.link} className="min-w-0 truncate font-medium hover:underline">
                    {item.title}
                  </Link>
                  <div className="flex flex-none items-center gap-2">
                    <span className="text-xs text-muted-foreground">{MODULE_LABELS[item.module]}</span>
                    <StatusBadge value={item.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
