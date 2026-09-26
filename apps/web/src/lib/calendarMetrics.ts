/**
 * Pure client-side helpers for the per-user Calendar feed (see
 * hooks/useCalendarItems.ts). Kept separate from workflowMetrics.ts, which is
 * scoped to the existing company-wide, endpoint-free workflow dashboards —
 * this one works off the real GET /calendar response instead of computing
 * "overdue" from raw module data client-side.
 */
import type { CalendarItem } from "../hooks/useCalendarItems";

export function isOverdue(item: CalendarItem): boolean {
  return !item.isTerminal && item.status === "overdue";
}

export function isUpcoming(item: CalendarItem): boolean {
  return !item.isTerminal && !isOverdue(item) && item.dueDate != null && new Date(item.dueDate) > new Date();
}

export interface CalendarSummary {
  openCount: number;
  overdueCount: number;
  completedThisMonthCount: number;
  upcomingCount: number;
}

export function summarizeCalendarItems(items: CalendarItem[]): CalendarSummary {
  let openCount = 0;
  let overdueCount = 0;
  let completedThisMonthCount = 0;
  let upcomingCount = 0;

  for (const item of items) {
    if (item.isTerminal) {
      completedThisMonthCount += 1;
      continue;
    }
    openCount += 1;
    if (isOverdue(item)) overdueCount += 1;
    else if (isUpcoming(item)) upcomingCount += 1;
  }

  return { openCount, overdueCount, completedThisMonthCount, upcomingCount };
}
