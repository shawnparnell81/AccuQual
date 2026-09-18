/**
 * Month-grid date math for the Calendar page/widget. No reusable
 * date-bucketing code existed anywhere in the app before this — the
 * Dashboard's "Audit Calendar" widget is just a sorted list, not a real
 * grid — so this is the first of its kind here.
 */
import type { CalendarItem } from "../hooks/useCalendarItems";

export interface MonthGridCell {
  date: Date;
  /** YYYY-MM-DD, local time — the key groupItemsByDay uses. */
  key: string;
  isCurrentMonth: boolean;
  isToday: boolean;
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Due dates are calendar days, not instants — every date-only input this
 * app has (the NCR/CAPA "Due date" field, etc.) round-trips through
 * `new Date("2026-09-25").toISOString()`, which the ES spec parses/re-emits
 * as UTC midnight specifically so the calendar day survives regardless of
 * viewer timezone. Reading it back with LOCAL getters (dayKey above) would
 * shift it a day earlier for anyone west of UTC — this reads the UTC
 * components instead, which is what actually recovers the original day.
 */
export function utcDayKey(isoString: string): string {
  const d = new Date(isoString);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Always 6 full weeks (42 cells), Sunday-start — a fixed-height grid never reflows the page as you page between months. */
export function buildMonthGrid(year: number, month: number): MonthGridCell[] {
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());
  const today = dayKey(new Date());

  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    return {
      date,
      key: dayKey(date),
      isCurrentMonth: date.getMonth() === month,
      isToday: dayKey(date) === today,
    };
  });
}

/** Items with no due date (a real, honest possibility — see CalendarItem.dueDate) are never placed on the grid; they still show in the Workflow Inbox. */
export function groupItemsByDay(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of items) {
    if (!item.dueDate) continue;
    const key = utcDayKey(item.dueDate);
    const existing = byDay.get(key);
    if (existing) existing.push(item);
    else byDay.set(key, [item]);
  }
  return byDay;
}
