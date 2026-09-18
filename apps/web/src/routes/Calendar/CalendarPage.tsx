import { MonthCalendar } from "../../components/calendar/MonthCalendar";

/**
 * The full-size Calendar — same GET /calendar data and the same
 * MonthCalendar component the Home page embeds a compact copy of, just
 * given its own page/tab instead of being squeezed under the Workflow
 * Inbox. Reachable from TopNav's CalendarButton (a personal view like
 * /home, not a department-permissioned module, so it isn't gated behind
 * the RBAC-driven Modules dropdown).
 */
export function CalendarPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Calendar</h1>
      <MonthCalendar />
    </div>
  );
}
