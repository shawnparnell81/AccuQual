import { useCurrentUser } from "../../hooks/useAuth";
import { useCalendarItems } from "../../hooks/useCalendarItems";
import { summarizeCalendarItems } from "../../lib/calendarMetrics";
import { StatCard } from "../../routes/Dashboard/DashboardPage";

/** Who-you-are + your own open/overdue/completed-this-month/upcoming counts, from the same GET /calendar feed the Workflow Inbox reads. */
export function UserDashboardHeader() {
  const user = useCurrentUser();
  const { items } = useCalendarItems();
  const summary = summarizeCalendarItems(items);

  const subtitle = [user?.roleName, user?.department].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">Welcome back{user?.name ? `, ${user.name}` : ""}</h2>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Open Items" value={summary.openCount} />
        <StatCard label="Overdue" value={summary.overdueCount} />
        <StatCard label="Completed This Month" value={summary.completedThisMonthCount} />
        <StatCard label="Upcoming" value={summary.upcomingCount} />
      </div>
    </div>
  );
}
