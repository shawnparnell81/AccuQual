import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNotifications } from "../../hooks/useNotifications";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";

function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  return date.toDateString() === today.toDateString() ? "Today" : "Earlier";
}

export function NotificationsPage() {
  const navigate = useNavigate();
  const { notifications, unreadCount, isLoading, markAllRead, markingAll, openNotice } = useNotifications(200);
  const [notice, setNotice] = useState<string | null>(null);

  const groups = ["Today", "Earlier"]
    .map((label) => ({ label, items: notifications.filter((entry) => dayLabel(entry.createdAt) === label) }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <p className="text-sm text-muted-foreground">{unreadCount === 0 ? "You're caught up." : `${unreadCount} unread`}</p>
        </div>
        <button
          type="button"
          disabled={unreadCount === 0 || markingAll}
          onClick={() => markAllRead()}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
        >
          Mark all read
        </button>
      </div>
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      {isLoading && <LoadingPlaceholder />}
      {!isLoading && notifications.length === 0 && <p className="text-sm text-muted-foreground">No notifications yet.</p>}
      {groups.map((group) => (
        <section key={group.label}>
          <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.label}</h2>
          <ul className="flex flex-col gap-1">
            {group.items.map((entry) => {
              const hasTarget = entry.relatedEntityType != null && entry.relatedEntityId != null;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setNotice(null);
                      void openNotice(entry.id).then((result) => {
                        if (result.status === "open") {
                          navigate(result.path);
                          return;
                        }
                        setNotice(result.status === "none" ? "This notice has no record to open." : "This record isn't available.");
                      });
                    }}
                    className="flex w-full flex-col items-start gap-0.5 rounded-md border border-border bg-card px-3 py-2 text-left text-sm hover:bg-secondary"
                  >
                    <span className="flex items-center gap-1.5">
                      {!entry.readAt && <span className="h-1.5 w-1.5 flex-none rounded-full bg-accent" />}
                      <span className={entry.readAt ? "text-muted-foreground" : "font-medium"}>{entry.subject}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      {hasTarget ? " · Open" : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
